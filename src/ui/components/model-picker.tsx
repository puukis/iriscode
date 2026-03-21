import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ResolvedConfig } from '../../config/schema.ts';
import { PROVIDER_ENV_VARS } from '../../config/secrets.ts';

interface ModelPickerProps {
  currentModel: string;
  availableModels: string[];
  config: ResolvedConfig;
  onSelect: (model: string) => void;
  onCancel: () => void;
  onConfigureProvider: (provider: keyof typeof PROVIDER_ENV_VARS, apiKey: string, model: string) => Promise<void>;
}

type ProviderName = keyof typeof PROVIDER_ENV_VARS | 'ollama';

const PROVIDER_MODEL_CATALOG: Record<ProviderName, string[]> = {
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  mistral: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  xai: ['grok-3', 'grok-3-mini', 'grok-2'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning'],
  together: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
  fireworks: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/deepseek-r1'],
  cohere: ['command-r-plus', 'command-r'],
  openrouter: ['anthropic/claude-sonnet-4-6'],
  ollama: [],
};

interface SelectableRow {
  label: string;
  value: string;
  provider: ProviderName;
  configured: boolean;
  kind: 'model' | 'provider';
}

export function ModelPicker({
  currentModel,
  availableModels,
  config,
  onSelect,
  onCancel,
  onConfigureProvider,
}: ModelPickerProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedProviders, setExpandedProviders] = useState<Set<ProviderName>>(
    () => new Set<ProviderName>(configuredProviders(config)),
  );
  const [pendingKey, setPendingKey] = useState<{ provider: keyof typeof PROVIDER_ENV_VARS; model: string } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const rows = useMemo(
    () => buildRows(availableModels, config, expandedProviders, query),
    [availableModels, config, expandedProviders, query],
  );

  useInput((input, key) => {
    if (pendingKey) {
      if (key.escape) {
        setPendingKey(null);
        setApiKeyInput('');
        return;
      }
      if (key.return) {
        void onConfigureProvider(pendingKey.provider, apiKeyInput, pendingKey.model)
          .then(() => {
            setPendingKey(null);
            setApiKeyInput('');
            onSelect(pendingKey.model);
          });
        return;
      }
      if (key.backspace || key.delete) {
        setApiKeyInput((current) => current.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setApiKeyInput((current) => current + input);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((current) => (current + rows.length - 1) % Math.max(rows.length, 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((current) => (current + 1) % Math.max(rows.length, 1));
      return;
    }
    if (key.return) {
      const row = rows[selectedIndex];
      if (!row) {
        return;
      }
      if (row.kind === 'provider') {
        setExpandedProviders((current) => {
          const next = new Set(current);
          if (next.has(row.provider)) {
            next.delete(row.provider);
          } else {
            next.add(row.provider);
          }
          return next;
        });
        return;
      }
      if (!row.configured && row.provider !== 'ollama' && row.provider in PROVIDER_ENV_VARS) {
        setPendingKey({
          provider: row.provider as keyof typeof PROVIDER_ENV_VARS,
          model: row.value,
        });
        setApiKeyInput('');
        return;
      }
      onSelect(row.value);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((current) => current.slice(0, -1));
      setSelectedIndex(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((current) => current + input);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginBottom={1}>
      <Text bold>Model picker</Text>
      {!pendingKey ? (
        <Text dimColor>{`Search: ${query || '(type to filter)'}`}</Text>
      ) : (
        <Text dimColor>{`API key (${pendingKey.provider}): ${'*'.repeat(apiKeyInput.length)}`}</Text>
      )}
      <Text dimColor>{`Current model: ${currentModel}`}</Text>
      {rows.length === 0 ? (
        <Text color="yellow">No models match the current filter.</Text>
      ) : (
        rows.slice(0, 20).map((row, index) => (
          <Text key={`${row.provider}:${row.value}`} color={index === selectedIndex ? 'cyan' : undefined}>
            {`${index === selectedIndex ? '›' : ' '} ${row.label}`}
          </Text>
        ))
      )}
      {pendingKey ? (
        <Text color="gray">Paste API key and press Enter. Esc cancels.</Text>
      ) : (
        <Text color="gray">Type to search. Enter selects. Esc cancels.</Text>
      )}
    </Box>
  );
}

function configuredProviders(config: ResolvedConfig): ProviderName[] {
  const providers: ProviderName[] = ['ollama'];
  for (const provider of Object.keys(PROVIDER_ENV_VARS) as Array<keyof typeof PROVIDER_ENV_VARS>) {
    if (config.providers[provider].apiKey) {
      providers.push(provider);
    }
  }
  return providers;
}

function buildRows(
  availableModels: string[],
  config: ResolvedConfig,
  expandedProviders: Set<ProviderName>,
  query: string,
): SelectableRow[] {
  const normalizedQuery = query.trim().toLowerCase();
  const configured = new Set(configuredProviders(config));
  const providerOrder: ProviderName[] = [
    ...configuredProviders(config),
    ...((Object.keys(PROVIDER_MODEL_CATALOG) as ProviderName[]).filter((provider) => !configured.has(provider))),
  ];

  const rows: SelectableRow[] = [];
  for (const provider of providerOrder) {
    const models = modelsForProvider(provider, availableModels);
    const filteredModels = normalizedQuery
      ? models.filter((model) => `${provider}/${model}`.toLowerCase().includes(normalizedQuery))
      : models;

    const configuredProvider = provider === 'ollama' || configured.has(provider);
    rows.push({
      label: `${configuredProvider ? '[key]' : '[lock]'} ${provider}`,
      value: provider,
      provider,
      configured: configuredProvider,
      kind: 'provider',
    });

    if (!expandedProviders.has(provider)) {
      continue;
    }

    const modelRows = filteredModels.length > 0
      ? filteredModels
      : provider === 'ollama'
        ? ['(no local models found)']
        : PROVIDER_MODEL_CATALOG[provider];

    for (const model of modelRows) {
      rows.push({
        label: `  ${provider}/${model}${configuredProvider ? '' : ` (${PROVIDER_ENV_VARS[provider as keyof typeof PROVIDER_ENV_VARS]})`}`,
        value: `${provider}/${model}`,
        provider,
        configured: configuredProvider,
        kind: 'model',
      });
    }
  }

  return rows;
}

function modelsForProvider(provider: ProviderName, availableModels: string[]): string[] {
  const dynamicModels = availableModels
    .filter((model) => model.startsWith(`${provider}/`))
    .map((model) => model.slice(provider.length + 1));

  if (dynamicModels.length > 0) {
    return dynamicModels;
  }

  return PROVIDER_MODEL_CATALOG[provider];
}
