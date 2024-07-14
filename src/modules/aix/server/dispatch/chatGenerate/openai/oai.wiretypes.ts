import { z } from 'zod';

import { openAPI_SchemaObject_schema } from '../../../intake/schemas.intake.tools';


//
// Implementation notes:
// - 2024-07-09: skipping Functions as they're deprecated
// - 2024-07-09: ignoring logprobs
// - 2024-07-09: ignoring the advanced model configuration
//

//
// Chat > Create chat completion
//

export namespace OpenAIWire_ContentParts {
  /// Content parts - Input

  export const TextContentPart_schema = z.object({
    type: z.literal('text'),
    text: z.string(),
  });

  export const ImageContentPart_schema = z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      // Either a URL of the image or the base64 encoded image data.
      url: z.string(),
      // Control how the model processes the image and generates its textual understanding.
      // https://platform.openai.com/docs/guides/vision/low-or-high-fidelity-image-understanding
      detail: z.enum(['auto', 'low', 'high']).optional(),
    }),
  });

  export const ContentPart_schema = z.discriminatedUnion('type', [
    TextContentPart_schema,
    ImageContentPart_schema,
  ]);

  export function TextContentPart(text: string): z.infer<typeof TextContentPart_schema> {
    return { type: 'text', text };
  }

  export function ImageContentPart(url: string, detail?: 'auto' | 'low' | 'high'): z.infer<typeof ImageContentPart_schema> {
    return { type: 'image_url', image_url: { url, detail } };
  }


  /// Content parts - Output

  export const PredictedFunctionCall_schema = z.object({
    type: z.literal('function'),
    id: z.string(),
    function: z.object({
      name: z.string(),
      /**
       * Note that the model does not always generate valid JSON, and may hallucinate parameters
       * not defined by your function schema.
       * Validate the arguments in your code before calling your function.
       */
      arguments: z.string(),
    }),
  });

  export const ToolCall_schema = z.discriminatedUnion('type', [
    PredictedFunctionCall_schema,
  ]);

  export function PredictedFunctionCall(toolCallId: string, functionName: string, functionArgs: string): z.infer<typeof PredictedFunctionCall_schema> {
    return { type: 'function', id: toolCallId, function: { name: functionName, arguments: functionArgs } };
  }
}

export namespace OpenAIWire_Messages {

  // Messages - Input

  // const _optionalParticipantName = z.string().optional();

  export const SystemMessage_schema = z.object({
    role: z.literal('system'),
    content: z.string(),
    // name: _optionalParticipantName,
  });

  export const UserMessage_schema = z.object({
    role: z.literal('user'),
    content: z.union([z.string(), z.array(OpenAIWire_ContentParts.ContentPart_schema)]),
    // name: _optionalParticipantName,
  });

  export const AssistantMessage_schema = z.object({
    role: z.literal('assistant'),
    /**
     * The contents of the assistant message. Required unless tool_calls or function_call is specified.
     */
    content: z.string().nullable(),
    /**
     * The tool calls generated by the model, such as function calls.
     */
    tool_calls: z.array(OpenAIWire_ContentParts.ToolCall_schema).optional(),
    // name: _optionalParticipantName,
  });

  export const ToolMessage_schema = z.object({
    role: z.literal('tool'),
    content: z.string(),
    tool_call_id: z.string(),
  });

  export const Message_schema = z.discriminatedUnion('role', [
    SystemMessage_schema,
    UserMessage_schema,
    AssistantMessage_schema,
    ToolMessage_schema,
  ]);
}

export namespace OpenAIWire_Tools {

  /// Tool definitions - Input

  export type FunctionDefinition = z.infer<typeof FunctionDefinition_schema>;
  export const FunctionDefinition_schema = z.object({
    /**
     * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.
     */
    name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, {
      message: 'Tool name must be 1-64 characters long and contain only letters, numbers, underscores, and hyphens',
    }),
    /**
     * A description of what the function does, used by the model to choose when and how to call the function.
     */
    description: z.string().optional(),
    /**
     * The parameters the functions accepts, described as a JSON Schema object.
     * Omitting parameters defines a function with an empty parameter list.
     */
    parameters: z.object({
      type: z.literal('object'),
      properties: z.record(openAPI_SchemaObject_schema),
      // Note: We commented out the code below in favor of the line above, because the OpenAPI 3.0.3 Schema object
      //       is in the 'Intake' API spec (.properties), and here we just need to pass that object upstream.
      // properties: z.record(z.object({
      //   type: z.enum(['string', 'number', 'integer', 'boolean']),
      //   description: z.string().optional(),
      //   enum: z.array(z.string()).optional(),
      // })),
      required: z.array(z.string()).optional(),
    }).optional(),
  });

  export const ToolDefinition_schema = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('function'),
      function: FunctionDefinition_schema,
    }),
  ]);

  export const ToolChoice_schema = z.union([
    z.literal('none'), // Do not use any tools
    z.literal('auto'), // Let the model decide whether to use tools or generate content
    z.literal('required'), // Must call one or more
    z.object({
      type: z.literal('function'),
      function: z.object({ name: z.string() }),
    }),
  ]);
}

export namespace OpenAIWire_API {

  /// API: Content Generation - Request

  export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequest_schema>;
  export const ChatCompletionRequest_schema = z.object({
    // basic input
    model: z.string(),
    messages: z.array(OpenAIWire_Messages.Message_schema),

    // tool definitions and calling policy
    tools: z.array(OpenAIWire_Tools.ToolDefinition_schema).optional(),
    tool_choice: OpenAIWire_Tools.ToolChoice_schema.optional(),
    parallel_tool_calls: z.boolean().optional(),

    // common model configuration
    max_tokens: z.number().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),

    // API configuration
    n: z.number().int().positive().optional(), // defaulting 'n' to 1, as the derived-ecosystem does not support it
    stream: z.boolean().optional(), // If set, partial message deltas will be sent, with the stream terminated by a `data: [DONE]` message.
    stream_options: z.object({
      include_usage: z.boolean().optional(), // If set, an additional chunk will be streamed with a 'usage' field on the entire request.
    }).optional(),
    response_format: z.object({
      type: z.enum([
        // default
        'text',

        /**
         * When using JSON mode, you must also instruct the model to produce JSON
         * yourself via a system or user message. Without this, the model may generate
         * an unending stream of whitespace until the generation reaches the token limit,
         * resulting in a long-running and seemingly "stuck" request.
         *
         * Also note that the message content may be partially cut off if
         * finish_reason="length", which indicates the generation exceeded max_tokens or
         * the conversation exceeded the max context length.
         */
        'json_object',
      ]),
    }).optional(),
    seed: z.number().int().optional(),
    stop: z.array(z.string()).optional(), // Up to 4 sequences where the API will stop generating further tokens.
    user: z.string().optional(),

    // (disabled) advanced model configuration
    // frequency_penalty: z.number().min(-2).max(2).optional(),
    // presence_penalty: z.number().min(-2).max(2).optional(),
    // logit_bias: z.record(z.number()).optional(),
    // logprobs: z.boolean().optional(),
    // top_logprobs: z.number().int().min(0).max(20).optional(),

    // (disabled) advanced API configuration
    // service_tier: z.unknown().optional(),

  });


  /// API: Content Generation - Output - Message

  export const FinishReason_Enum = z.enum([
    'stop', // natural completion, or stop sequence hit
    'length', // max_tokens exceeded
    'tool_calls', // the model called a tool
    'content_filter', // upstream content filter stopped the generation
    // Extensions //
    '', // [LocalAI] bad response from LocalAI which breaks the parser
    'stop_sequence', // [OpenRouter->Anthropic] added 'stop_sequence' which is the same as 'stop'
    'eos', // [OpenRouter->Phind]
    'COMPLETE', // [OpenRouter->Command-R+]
    'error', // [OpenRouter] their network error
  ]);

  export const Usage_schema = z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }).nullable();

  export const UndocumentedError_schema = z.object({
    // (undocumented) first experienced on 2023-06-19 on streaming APIs
    message: z.string().optional(),
    type: z.string().optional(),
    param: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
  });

  export const UndocumentedWarning_schema = z.string();

  export const ChatCompletionChoice_schema = z.object({
    index: z.number(),

    // NOTE: the OpenAI api does not force role: 'assistant', it's only induced
    // We recycle the assistant message response here, with either content or tool_calls
    message: OpenAIWire_Messages.AssistantMessage_schema,

    finish_reason: FinishReason_Enum,
    // logprobs: ... // Log probability information for the choice.
  });

  export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponse_schema>;
  export const ChatCompletionResponse_schema = z.object({
    object: z.literal('chat.completion'),
    id: z.string(), // A unique identifier for the chat completion.

    /**
     * A list of chat completion choices. Can be more than one if n is greater than 1.
     */
    choices: z.array(ChatCompletionChoice_schema),

    model: z.string(), // The model used for the chat completion.
    usage: Usage_schema.optional(), // If requested
    created: z.number(), // The Unix timestamp (in seconds) of when the chat completion was created.
    system_fingerprint: z.string().optional() // The backend configuration that the model runs with.
      .nullable(), // [Grow, undocumented OpenAI] fingerprint is null on some OpenAI examples too
    // service_tier: z.unknown().optional(),
  });


  /// API: Content Generation - Output - Message CHUNKS

  /* Note: this is like the predicted function call, but with fields optional,
     as after the first chunk (which carries type and id), the model will just emit
     some index and function.arguments

     Note2: we found issues with Together, Openrouter, Mistral, and others we don't remember
     This object's status is really a mess for OpenAI and their downstream 'compatibles'.
   */
  export const ChatCompletionChunkDeltaToolCalls_schema = z.object({
    index: z.number() // index is not present in non-streaming calls
      .optional(), // [Mitral] not present

    type: z.literal('function').optional(), // currently (2024-07-14) only 'function' is supported

    id: z.string().optional(), // id of the tool call

    function: z.object({
      // [TogetherAI] added .nullable() - exclusive with 'arguments'
      name: z.string().optional().nullable(),
      /**
       * Note that the model does not always generate valid JSON, and may hallucinate parameters
       * not defined by your function schema.
       * Validate the arguments in your code before calling your function.
       * [TogetherAI] added .nullable() - exclusive with 'name'
       */
      arguments: z.string().optional().nullable(),
    }),
  });

  export const ChatCompletionChunkDelta_schema = z.object({
    role: z.literal('assistant').optional()
      .nullable(), // [Deepseek] added .nullable()
    content: z.string().nullable().optional(),
    tool_calls: z.array(ChatCompletionChunkDeltaToolCalls_schema).optional(),
  });

  export const ChatCompletionChunkChoice_schema = z.object({
    index: z.number()
      .optional(), // [OpenRouter] added .optional() which implies index=0 I guess

    // A chat completion delta generated by streamed model responses.
    delta: ChatCompletionChunkDelta_schema,

    finish_reason: FinishReason_Enum.nullable()
      .optional(), // [OpenRouter] added .optional() which only has the delta field in the whole chunk choice
    // logprobs: ... // Log probability information for the choice.
  });

  export const ChatCompletionChunkResponse_schema = z.object({
    object: z.enum([
      'chat.completion.chunk',
      'chat.completion', // [Perplexity] sent an email on 2024-07-14 to inform them about the misnomer
      '', // [Azure] bad response: the first packet communicates 'prompt_filter_results'
    ]),
    id: z.string(),

    /**
     * A list of chat completion choices.
     * Can contain more than one elements if n is greater than 1.
     * Can also be empty for the last chunk if you set stream_options: {"include_usage": true}
     */
    choices: z.array(ChatCompletionChunkChoice_schema),

    model: z.string(), // The model used for the chat completion.
    usage: Usage_schema.optional(), // If requested
    created: z.number(), // The Unix timestamp (in seconds) of when the chat completion was created.
    system_fingerprint: z.string().optional() // The backend configuration that the model runs with.
      .nullable(), // [Grow, undocumented OpenAI] fingerprint is null on some OpenAI examples too
    // service_tier: z.unknown().optional(),

    // undocumented streaming messages
    error: UndocumentedError_schema.optional(),
    warning: UndocumentedWarning_schema.optional(),
  });

}


//
// Images > Create Image
// https://platform.openai.com/docs/api-reference/images/create
//

export type OpenaiWire_CreateImageRequest = z.infer<typeof openaiWire_CreateImageRequest_schema>;
const openaiWire_CreateImageRequest_schema = z.object({
  // The maximum length is 1000 characters for dall-e-2 and 4000 characters for dall-e-3
  prompt: z.string().max(4000),

  // The model to use for image generation
  model: z.enum(['dall-e-2', 'dall-e-3']).optional().default('dall-e-2'),

  // The number of images to generate. Must be between 1 and 10. For dall-e-3, only n=1 is supported.
  n: z.number().min(1).max(10).nullable().optional(),

  // 'hd' creates images with finer details and greater consistency across the image. This param is only supported for dall-e-3
  quality: z.enum(['standard', 'hd']).optional(),

  // The format in which the generated images are returned
  response_format: z.enum(['url', 'b64_json']).optional(), //.default('url'),

  // 'dall-e-2': must be one of 256x256, 512x512, or 1024x1024
  // 'dall-e-3': must be one of 1024x1024, 1792x1024, or 1024x1792
  size: z.enum(['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792']).optional().default('1024x1024'),

  // only used by 'dall-e-3': 'vivid' (hyper-real and dramatic images) or 'natural'
  style: z.enum(['vivid', 'natural']).optional().default('vivid'),

  // A unique identifier representing your end-user
  user: z.string().optional(),
});


export type OpenaiWire_CreateImageResponse = z.infer<typeof openaiWire_CreateImageResponse_schema>;
export const openaiWire_CreateImageResponse_schema = z.object({
  created: z.number(),
  data: z.array(z.object({
    url: z.string().url().optional(),
    b64_json: z.string().optional(),
    revised_prompt: z.string().optional(),
  })),
});


//
// Models > List Models
//

// Model object schema
export type OpenaiWire_Model = z.infer<typeof openaiWire_Model_schema>;
const openaiWire_Model_schema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number().optional(),
  // [dialect:OpenAI] 'openai' | 'openai-dev' | 'openai-internal' | 'system'
  // [dialect:Oobabooga] 'user'
  owned_by: z.string().optional(),

  // **Extensions**
  // [Openrouter] non-standard - commented because dynamically added by the Openrouter vendor code
  // context_length: z.number().optional(),
});

// List models response schema
export type OpenaiWire_ModelList = z.infer<typeof openaiWire_ModelList_schema>;
const openaiWire_ModelList_schema = z.object({
  object: z.literal('list'),
  data: z.array(openaiWire_Model_schema),
});


//
// Moderations > Create Moderation
//

export const openaiWire_ModerationCategory_schema = z.enum([
  'sexual',
  'hate',
  'harassment',
  'self-harm',
  'sexual/minors',
  'hate/threatening',
  'violence/graphic',
  'self-harm/intent',
  'self-harm/instructions',
  'harassment/threatening',
  'violence',
]);

export type OpenaiWire_ModerationRequest = z.infer<typeof openaiWire_ModerationRequest_schema>;
const openaiWire_ModerationRequest_schema = z.object({
  // input: z.union([z.string(), z.array(z.string())]),
  input: z.string(),
  model: z.enum(['text-moderation-stable', 'text-moderation-latest']).optional(),
});

const openaiWire_ModerationResult_schema = z.object({
  flagged: z.boolean(),
  categories: z.record(openaiWire_ModerationCategory_schema, z.boolean()),
  category_scores: z.record(openaiWire_ModerationCategory_schema, z.number()),
});

export type OpenaiWire_ModerationResponse = z.infer<typeof openaiWire_ModerationResponse_schema>;
const openaiWire_ModerationResponse_schema = z.object({
  id: z.string(),
  model: z.string(),
  results: z.array(openaiWire_ModerationResult_schema),
});
