import type { AixAPI_ContextChatStream, AixAPIChatGenerate_Request } from '~/modules/aix/server/api/aix.wiretypes';
import { aixChatGenerateRequestFromDMessages } from '~/modules/aix/client/aix.client.fromDMessages.api';
import { aixStreamingChatGenerate, StreamingClientUpdate } from '~/modules/aix/client/aix.client';
import { autoConversationTitle } from '~/modules/aifn/autotitle/autoTitle';
import { autoSuggestions } from '~/modules/aifn/autosuggestions/autoSuggestions';

import type { DConversationId } from '~/common/stores/chat/chat.conversation';
import type { DLLMId } from '~/common/stores/llms/dllm.types';
import type { DMessage } from '~/common/stores/chat/chat.message';
import { ConversationsManager } from '~/common/chat-overlay/ConversationsManager';
import { getUXLabsHighPerformance } from '~/common/state/store-ux-labs';

import { PersonaChatMessageSpeak } from './persona/PersonaChatMessageSpeak';
import { getChatAutoAI } from '../store-app-chat';
import { getInstantAppChatPanesCount } from '../components/panes/usePanesManager';
import { createErrorContentFragment } from '~/common/stores/chat/chat.fragments';


export interface PersonaProcessorInterface {
  handleMessage(accumulatedMessage: Partial<StreamMessageUpdate>, messageComplete: boolean): void;
}


/**
 * The main "chat" function.
 */
export async function runPersonaOnConversationHead(
  assistantLlmId: DLLMId,
  conversationId: DConversationId,
): Promise<boolean> {

  const cHandler = ConversationsManager.getHandler(conversationId);

  const history = cHandler.historyViewHead('runPersonaOnConversationHead') as Readonly<DMessage[]>;

  const parallelViewCount = getUXLabsHighPerformance() ? 0 : getInstantAppChatPanesCount();

  // ai follow-up operations (fire/forget)
  const { autoSpeak, autoSuggestDiagrams, autoSuggestHTMLUI, autoSuggestQuestions, autoTitleChat } = getChatAutoAI();

  // assistant placeholder
  const { assistantMessageId } = cHandler.messageAppendAssistantPlaceholder(
    '...',
    { originLLM: assistantLlmId, purposeId: history[0].purposeId },
  );

  // AutoSpeak
  const autoSpeaker: PersonaProcessorInterface | null = autoSpeak !== 'off' ? new PersonaChatMessageSpeak(autoSpeak) : null;

  // when an abort controller is set, the UI switches to the "stop" mode
  const abortController = new AbortController();
  cHandler.setAbortController(abortController);


  // stream the assistant's messages directly to the state store
  const aixChatContentGenerateRequest = await aixChatGenerateRequestFromDMessages(history);
  const messageStatus = await llmGenerateContentStream(
    assistantLlmId,
    aixChatContentGenerateRequest,
    'conversation',
    conversationId,
    parallelViewCount,
    abortController.signal,
    (messageOverwrite: StreamMessageUpdate, messageComplete: boolean) => {
      if (abortController.signal.aborted) return;

      // typing sound
      // if (messageComplete)
      //   AudioGenerator.basicAstralChimes({ volume: 0.4 }, 0, 2, 250);

      cHandler.messageEdit(assistantMessageId, messageOverwrite, messageComplete, false);

      autoSpeaker?.handleMessage(messageOverwrite, messageComplete);
    },
  );

  // check if aborted
  const hasBeenAborted = abortController.signal.aborted;

  // clear to send, again
  // FIXME: race condition? (for sure!)
  cHandler.setAbortController(null);

  if (autoTitleChat) {
    // fire/forget, this will only set the title if it's not already set
    void autoConversationTitle(conversationId, false);
  }

  if (!hasBeenAborted && (autoSuggestDiagrams || autoSuggestHTMLUI || autoSuggestQuestions))
    autoSuggestions(null, conversationId, assistantMessageId, autoSuggestDiagrams, autoSuggestHTMLUI, autoSuggestQuestions);

  return messageStatus.outcome === 'success';
}


type StreamMessageOutcome = 'success' | 'aborted' | 'errored';
type StreamMessageStatus = { outcome: StreamMessageOutcome, errorMessage?: string };
export type StreamMessageUpdate = Pick<DMessage, 'fragments' | 'originLLM' | 'pendingIncomplete' | 'metadata'>;

export async function llmGenerateContentStream(
  llmId: DLLMId,
  aixChatGenerate: AixAPIChatGenerate_Request,
  aixContextName: AixAPI_ContextChatStream['name'],
  aixContextRef: AixAPI_ContextChatStream['ref'],
  parallelViewCount: number, // 0: disable, 1: default throttle (12Hz), 2+ reduce frequency with the square root
  abortSignal: AbortSignal,
  onMessageUpdated: (messageOverwrite: StreamMessageUpdate, messageComplete: boolean) => void,
): Promise<StreamMessageStatus> {

  const returnStatus: StreamMessageStatus = { outcome: 'success', errorMessage: undefined };

  const throttler = new ThrottleFunctionCall(parallelViewCount);

  // TODO: should clean this up once we have multi-fragment streaming/recombination
  const messageOverwrite: StreamMessageUpdate = {
    fragments: [],
  };

  try {

    await aixStreamingChatGenerate(llmId, aixChatGenerate, aixContextName, aixContextRef, true, abortSignal,
      (update: StreamingClientUpdate, done: boolean) => {

        // convert the StreamingClientUpdate to the StreamMessageUpdate
        const { typing, stats, fragments, originLLM, metadata } = update;
        messageOverwrite.pendingIncomplete = typing ? true : undefined;
        messageOverwrite.fragments = fragments;
        messageOverwrite.originLLM = originLLM;
        if (metadata)
          messageOverwrite.metadata = metadata;

        console.log('overwrite', messageOverwrite, stats);

        // throttle the update - and skip the last done message
        if (!done)
          throttler.decimate(() => onMessageUpdated(messageOverwrite, done));
      },
    );

  } catch (error: any) {
    // if (error?.name !== 'AbortError') {
      console.error('Fetch request error:', error);
      const errorFragment = createErrorContentFragment(`Issue: ${error.message || (typeof error === 'string' ? error : 'Chat stopped.')}`);
      messageOverwrite.fragments.push(errorFragment);
      returnStatus.outcome = 'errored';
      returnStatus.errorMessage = error.message;
    // } else
    //   returnStatus.outcome = 'aborted';
  }

  // Ensure the last content is flushed out, and mark as complete
  throttler.finalize(() => onMessageUpdated(messageOverwrite, true));

  return returnStatus;
}


export class ThrottleFunctionCall {
  private readonly throttleDelay: number;
  private lastCallTime: number = 0;

  constructor(throttleUnits: number) {
    // 12 messages per second works well for 60Hz displays (single chat, and 24 in 4 chats, see the square root below)
    const baseDelayMs = 1000 / 12;
    this.throttleDelay = throttleUnits === 0 ? 0
      : throttleUnits > 1 ? Math.round(baseDelayMs * Math.sqrt(throttleUnits))
        : baseDelayMs;
  }

  decimate(fn: () => void): void {
    const now = Date.now();
    if (this.throttleDelay === 0 || this.lastCallTime === 0 || now - this.lastCallTime >= this.throttleDelay) {
      fn();
      this.lastCallTime = now;
    }
  }

  finalize(fn: () => void): void {
    fn(); // Always execute the final update
    this.lastCallTime = 0; // Reset the throttle
  }
}
