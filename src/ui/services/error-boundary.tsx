import React from 'react';
import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { Box, Text } from 'ink';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
  };

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ error });
    writeDebugLog(error, errorInfo);
  }

  override render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>IrisCode encountered a render error.</Text>
        <Text color="gray">Check ~/.iris/debug.log for details.</Text>
        <Text color="gray">Restart the app to continue.</Text>
      </Box>
    );
  }
}

function writeDebugLog(error: Error, errorInfo: React.ErrorInfo): void {
  try {
    const logPath = resolve(process.env.HOME ?? homedir(), '.iris', 'debug.log');
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(
      logPath,
      [
        `\n[${new Date().toISOString()}] Render error`,
        error.stack ?? error.message,
        errorInfo.componentStack,
        '',
      ].join('\n'),
      'utf-8',
    );
  } catch {
    // Avoid throwing from the error boundary itself.
  }
}
