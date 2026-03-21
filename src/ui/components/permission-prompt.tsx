import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ToolDefinitionSchema } from '../../shared/types.ts';
import type { PermissionRequest } from '../../permissions/types.ts';
import type { ToolPermissionChoice } from '../../agent/loop.ts';

type RiskLevel = 'low' | 'medium' | 'high';

interface PermissionPromptProps {
  request: PermissionRequest;
  tool?: ToolDefinitionSchema;
  onSelect: (choice: ToolPermissionChoice) => void;
}

const OPTIONS: Array<{ label: string; value: ToolPermissionChoice; shortcut: string }> = [
  { label: 'Allow once', value: 'allow-once', shortcut: 'y' },
  { label: 'Allow always', value: 'allow-always', shortcut: 'Y' },
  { label: 'Deny once', value: 'deny-once', shortcut: 'n' },
  { label: 'Deny always', value: 'deny-always', shortcut: 'N' },
];

const LOW_RISK_TOOLS = new Set(['read', 'glob', 'grep', 'git-status', 'git-diff', 'tool-search', 'ask-user']);
const MEDIUM_RISK_TOOLS = new Set(['write', 'edit', 'web-fetch', 'web-search', 'skill', 'todo-write']);

export function PermissionPrompt({ request, tool, onSelect }: PermissionPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const formattedInput = useMemo(
    () => formatPermissionInput(request.input).split('\n'),
    [request.input],
  );
  const riskLevel = getPermissionRiskLevel(request.toolName);
  const riskColor = getRiskColor(riskLevel);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((current) => (current + OPTIONS.length - 1) % OPTIONS.length);
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((current) => (current + 1) % OPTIONS.length);
      return;
    }

    if (key.return) {
      onSelect(OPTIONS[selectedIndex].value);
      return;
    }

    if (key.escape || input === 'n') {
      onSelect('deny-once');
      return;
    }

    if (input === 'y') {
      onSelect('allow-once');
      return;
    }

    if (input === 'Y') {
      onSelect('allow-always');
      return;
    }

    if (input === 'N') {
      onSelect('deny-always');
    }
  });

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={riskColor} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>Permission required</Text>
        <Text color={riskColor} bold>{riskLevel.toUpperCase()}</Text>
      </Box>
      <Text>{describePermissionRequest(request)}</Text>
      {tool?.description ? <Text color="gray">{tool.description}</Text> : null}
      <Text bold>Input</Text>
      {formattedInput.map((line, index) => (
        <Text key={index} color="gray">{`  ${line}`}</Text>
      ))}
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((option, index) => (
          <Text key={option.value} color={index === selectedIndex ? 'cyan' : undefined}>
            {`${index === selectedIndex ? '›' : ' '} ${option.label} (${option.shortcut})`}
          </Text>
        ))}
      </Box>
      <Text color="gray">Shortcuts: y allow once, Y allow always, n deny once, N deny always, Esc deny once</Text>
    </Box>
  );
}

export function describePermissionRequest(request: PermissionRequest): string {
  const input = request.input;

  switch (request.toolName) {
    case 'bash':
      return `bash: ${truncate(String(input.command ?? '(no command)'))}`;
    case 'read':
    case 'write':
    case 'edit':
      return `${request.toolName}: ${truncate(String(input.path ?? '(no path)'))}`;
    case 'web-fetch':
      return `web-fetch: ${truncate(String(input.url ?? '(no url)'))}`;
    case 'web-search':
      return `web-search: ${truncate(String(input.query ?? '(no query)'))}`;
    case 'git-commit':
      return `git-commit: ${truncate(String(input.message ?? '(no message)'))}`;
    case 'task':
      return `task: ${truncate(String(input.description ?? '(no description)'))}`;
    case 'todo-write':
      return `todo-write: ${Array.isArray(input.todos) ? input.todos.length : 0} todos`;
    case 'ask-user':
      return `ask-user: ${truncate(String(input.question ?? '(no question)'))}`;
    default:
      return `${request.toolName}: ${truncate(previewInput(input))}`;
  }
}

export function formatPermissionInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function getPermissionRiskLevel(toolName: string): RiskLevel {
  if (LOW_RISK_TOOLS.has(toolName)) {
    return 'low';
  }

  if (MEDIUM_RISK_TOOLS.has(toolName)) {
    return 'medium';
  }

  return 'high';
}

function getRiskColor(level: RiskLevel): 'green' | 'yellow' | 'red' {
  if (level === 'low') {
    return 'green';
  }
  if (level === 'medium') {
    return 'yellow';
  }
  return 'red';
}

function previewInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input);
  } catch {
    return Object.entries(input)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');
  }
}

function truncate(value: string, length = 96): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length - 3)}...`;
}
