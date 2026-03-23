import React, { useEffect } from 'react';
import { Box, Text } from 'ink';

interface SplashProps {
  onDone: () => void;
}

const SPLASH_LINES = [
  '╭────────────────────────────────────────────╮',
  '│                                            │',
  '│  ██╗██████╗ ██╗███████╗                    │',
  '│  ██║██╔══██╗██║██╔════╝                    │',
  '│  ██║██████╔╝██║███████╗                    │',
  '│  ██║██╔══██╗██║╚════██║   C O D E          │',
  '│  ██║██║  ██║██║███████║                    │',
  '│  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝                    │',
  '│                                            │',
  '│  model-agnostic AI coding agent            │',
  '│  v0.1.0                                    │',
  '│                                            │',
  '╰────────────────────────────────────────────╯',
];

export function Splash({ onDone }: SplashProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1500);
    timer.unref?.();
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <Box flexDirection="column">
      {SPLASH_LINES.map((line, index) => (
        <Text key={`splash-${index}`}>{line}</Text>
      ))}
    </Box>
  );
}
