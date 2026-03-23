import React, { memo, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { bus } from '../../shared/events.ts';
import type { PermissionMode } from '../../permissions/types.ts';
import { theme } from '../theme.ts';
import { MEMORY_TOKEN_LIMIT, MEMORY_WARN_AT } from '../../memory/budget.ts';

interface CostBarProps {
  model: string;
  mode: PermissionMode;
  memoryTokens: number;
  memoryMaxTokens: number;
  sessionId: string;
  projectName: string;
  mcpServerCount?: number;
}

export const CostBar = memo(function CostBar({
  model,
  mode,
  memoryTokens,
  memoryMaxTokens,
  sessionId,
  projectName,
  mcpServerCount = 0,
}: CostBarProps) {
  const [cost, setCost] = useState({ input: 0, output: 0, totalUsd: 0 });
  const [budgetTokens, setBudgetTokens] = useState<number | null>(null);
  const showSessionId = (process.stdout.columns ?? 80) > 80;

  // Use budget-event token count if available; otherwise fall back to prop
  const effectiveTokens = budgetTokens ?? memoryTokens;
  const effectiveMax = memoryMaxTokens > 0 ? memoryMaxTokens : MEMORY_TOKEN_LIMIT;
  const memoryRatio = Math.min(1, effectiveTokens / effectiveMax);
  const barSlots = showSessionId ? 12 : 8;
  const filledSlots = Math.round(memoryRatio * barSlots);
  const memoryBar = `${'█'.repeat(filledSlots)}${'░'.repeat(Math.max(0, barSlots - filledSlots))}`;

  const memoryColor =
    effectiveTokens >= MEMORY_TOKEN_LIMIT
      ? theme.colors.error
      : effectiveTokens >= MEMORY_WARN_AT
        ? theme.colors.warning
        : theme.colors.success;

  useEffect(() => {
    return bus.on('cost:update', ({ inputTokens, outputTokens, totalCostUsd }) => {
      setCost((current) => ({
        input: current.input + inputTokens,
        output: current.output + outputTokens,
        totalUsd: totalCostUsd,
      }));
    });
  }, []);

  useEffect(() => {
    return bus.on('memory:budget', ({ budget }) => {
      setBudgetTokens(budget.totalTokens);
    });
  }, []);

  return (
    <Box justifyContent="space-between">
      <Box>
        <Text color={theme.colors.muted}>{friendlyModelLabel(model)}</Text>
        <Text color={theme.colors.line}>{' │ '}</Text>
        <Text color={theme.colors.muted}>{projectName}</Text>
        <Text color={theme.colors.line}>{' '}</Text>
        <Text color={memoryColor}>{memoryBar}</Text>
        <Text color={memoryColor}>{` ${effectiveTokens.toLocaleString()} / ${effectiveMax.toLocaleString()} tokens`}</Text>
        {mcpServerCount > 0 ? (
          <>
            <Text color={theme.colors.line}>{' │ '}</Text>
            <Text color={theme.colors.accent}>{`MCP: ${mcpServerCount}`}</Text>
          </>
        ) : null}
        {!showSessionId ? (
          <>
            <Text color={theme.colors.line}>{' │ '}</Text>
            <Text color={theme.colors.muted}>{modeLabel(mode)}</Text>
          </>
        ) : null}
      </Box>
      <Box>
        <Text color={theme.colors.line}>{'● '}</Text>
        <Text color={theme.colors.muted}>{modeLabel(mode)}</Text>
        {showSessionId ? (
          <>
            <Text color={theme.colors.line}>{' · '}</Text>
            <Text color={theme.colors.muted}>{sessionId}</Text>
          </>
        ) : null}
      </Box>
    </Box>
  );
});

function friendlyModelLabel(model: string): string {
  return model.replace(/^anthropic\//, '').replace(/^openai\//, '').replace(/^ollama\//, '');
}

function modeLabel(mode: PermissionMode): string {
  if (mode === 'acceptEdits') return 'accept edits';
  if (mode === 'plan') return 'plan';
  return 'default';
}
