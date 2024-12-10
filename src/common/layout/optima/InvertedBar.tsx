import * as React from 'react';

import type { SxProps } from '@mui/joy/styles/types';
import { Box, Sheet, styled, useTheme } from '@mui/joy';

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

  // Use the useTheme hook to get the current theme
  const theme = useTheme();

  // Function to set the theme mode
  const setDarkMode = () => {
    // Access the global CSS variables and set the dark mode colors
    document.documentElement.style.setProperty('--mui-palette-background-body', '#121212');
    document.documentElement.style.setProperty('--mui-palette-background-surface', '#121212');
    document.documentElement.style.setProperty('--mui-palette-background-level1', '#242424');
    document.documentElement.style.setProperty('--mui-palette-background-level2', '#363636');
    document.documentElement.style.setProperty('--mui-palette-background-level3', '#484848');
    document.documentElement.style.setProperty('--mui-palette-text-primary', '#FFFFFF');
    document.documentElement.style.setProperty('--mui-palette-text-secondary', '#EDEDED');
    document.documentElement.style.setProperty('--mui-palette-text-tertiary', '#DDDDDD');
  };

  // Set dark mode on component mount
  React.useEffect(() => {
    setDarkMode();
  }, []);

  // memoize the Sx for stability, based on direction
  const sx: SxProps = React.useMemo(() => (
    props.direction === 'horizontal'
      ? {
        // minHeight: 'var(--Bar)',
        flexDirection: 'row',
        // overflow: 'hidden',
        ...props.sx,
      } : {
        // minWidth: 'var(--Bar)',
        flexDirection: 'column',
        ...props.sx,
      }
  ), [props.direction, props.sx]);

  return (
    <StyledSheet
      id={props.id}
      component={props.component}
      variant={'soft'} // Always use 'soft' for dark mode
      invertedColors={true} // Always invert colors for dark mode
      sx={sx}
    >
      {props.children}
    </StyledSheet>
  );
};
