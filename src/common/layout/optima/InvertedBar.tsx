import * as React from 'react';
import type { SxProps } from '@mui/joy/styles/types';
import { Box, Sheet, styled, useTheme, extendTheme, CssVarsProvider, getInitColorSchemeScript } from '@mui/joy';

// Create a custom theme that extends the default Joy theme
const customTheme = extendTheme({
  colorSchemes: {
    dark: {
      palette: {
        background: {
          body: '#121212',
          surface: '#121212',
          level1: '#242424',
          level2: '#363636',
          level3: '#484848',
        },
        text: {
          primary: '#FFFFFF',
          secondary: '#EDEDED',
          tertiary: '#DDDDDD',
        },
      },
    },
  },
});

export const InvertedBarCornerItem = styled(Box)({
  width: 'var(--Bar)',
  height: 'var(--Bar)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
});

const StyledSheet = styled(Sheet)({
  // customization
  '--Bar': 'var(--AGI-Nav-width)',

  // layout
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}) as typeof Sheet;

// This is the PageBar and the MobileAppNav and DesktopNav
export const InvertedBar = (props: {
  id?: string,
  component: React.ElementType,
  direction: 'horizontal' | 'vertical',
  sx?: SxProps
  children: React.ReactNode,
}) => {

  // memoize the Sx for stability, based on direction
  const sx: SxProps = React.useMemo(() => (
    props.direction === 'horizontal'
      ? {
        flexDirection: 'row',
        ...props.sx,
      } : {
        flexDirection: 'column',
        ...props.sx,
      }
  ), [props.direction, props.sx]);

  return (
    <CssVarsProvider theme={customTheme} defaultMode='dark'>
      {/* This script is essential for initializing the color scheme */}
      {getInitColorSchemeScript()} 
      <StyledSheet
        id={props.id}
        component={props.component}
        variant={'soft'}
        invertedColors={true}
        sx={sx}
      >
        {props.children}
      </StyledSheet>
    </CssVarsProvider>
  );
};
