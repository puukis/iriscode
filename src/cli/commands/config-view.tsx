import React, { useMemo, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { loadConfig } from '../../config/loader.ts';
import type { IrisConfig } from '../../config/schema.ts';
import { loadUserConfig, writeUserConfig } from '../../config/user.ts';
import type { PermissionMode } from '../../permissions/types.ts';
import { resolveRules } from '../../permissions/tiers.ts';

type Screen = 'menu' | 'view' | 'mode' | 'allowed' | 'blocked' | 'api-select' | 'api-input';

const MENU_OPTIONS = [
  'View current resolved config',
  'Set default mode',
  'Edit allowed tools list',
  'Edit blocked tools list',
  'Set/update API keys',
  'Exit',
] as const;

const MODE_OPTIONS: PermissionMode[] = ['default', 'acceptEdits', 'plan'];
const API_KEY_FIELDS: Array<{ key: keyof IrisConfig; label: string }> = [
  { key: 'anthropicApiKey', label: 'Anthropic API key' },
  { key: 'openaiApiKey', label: 'OpenAI API key' },
  { key: 'googleApiKey', label: 'Google API key' },
  { key: 'groqApiKey', label: 'Groq API key' },
  { key: 'mistralApiKey', label: 'Mistral API key' },
  { key: 'deepseekApiKey', label: 'DeepSeek API key' },
  { key: 'xaiApiKey', label: 'xAI API key' },
  { key: 'perplexityApiKey', label: 'Perplexity API key' },
  { key: 'togetherApiKey', label: 'Together API key' },
  { key: 'fireworksApiKey', label: 'Fireworks API key' },
  { key: 'cohereApiKey', label: 'Cohere API key' },
  { key: 'openrouterApiKey', label: 'OpenRouter API key' },
  { key: 'ollamaBaseUrl', label: 'Ollama base URL' },
] as const;

export async function runConfigCommand(cwd: string = process.cwd()): Promise<void> {
  await new Promise<void>((resolve) => {
    let app: ReturnType<typeof render>;
    app = render(
      <ConfigApp
        cwd={cwd}
        onExit={() => {
          app.unmount();
          resolve();
        }}
      />,
    );
  });
}

function ConfigApp({ cwd, onExit }: { cwd: string; onExit: () => void }) {
  const [screen, setScreen] = useState<Screen>('menu');
  const [menuIndex, setMenuIndex] = useState(0);
  const [modeIndex, setModeIndex] = useState(() => {
    const currentMode = loadUserConfig().mode ?? 'default';
    return Math.max(0, MODE_OPTIONS.indexOf(currentMode));
  });
  const [apiIndex, setApiIndex] = useState(0);
  const [editingValue, setEditingValue] = useState('');
  const [editingField, setEditingField] = useState<keyof IrisConfig | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [userConfig, setUserConfig] = useState<Partial<IrisConfig>>(() => loadUserConfig());

  const resolvedConfig = useMemo(() => loadConfig(cwd), [cwd, userConfig, screen, status]);
  const resolvedRules = useMemo(() => resolveRules(cwd), [cwd, userConfig, screen, status]);

  useInput((input, key) => {
    if (screen === 'menu') {
      if (key.upArrow) {
        setMenuIndex((current) => (current + MENU_OPTIONS.length - 1) % MENU_OPTIONS.length);
        return;
      }
      if (key.downArrow) {
        setMenuIndex((current) => (current + 1) % MENU_OPTIONS.length);
        return;
      }
      if (key.return) {
        handleMenuSelection(menuIndex);
        return;
      }
      if (input === 'q' || key.escape) {
        onExit();
      }
      return;
    }

    if (screen === 'view') {
      if (key.escape || input === 'b') {
        setScreen('menu');
      }
      return;
    }

    if (screen === 'mode') {
      if (key.upArrow) {
        setModeIndex((current) => (current + MODE_OPTIONS.length - 1) % MODE_OPTIONS.length);
        return;
      }
      if (key.downArrow) {
        setModeIndex((current) => (current + 1) % MODE_OPTIONS.length);
        return;
      }
      if (key.return) {
        saveConfig({ ...userConfig, mode: MODE_OPTIONS[modeIndex] });
        setScreen('menu');
        return;
      }
      if (key.escape) {
        setScreen('menu');
      }
      return;
    }

    if (screen === 'api-select') {
      if (key.upArrow) {
        setApiIndex((current) => (current + API_KEY_FIELDS.length - 1) % API_KEY_FIELDS.length);
        return;
      }
      if (key.downArrow) {
        setApiIndex((current) => (current + 1) % API_KEY_FIELDS.length);
        return;
      }
      if (key.return) {
        const field = API_KEY_FIELDS[apiIndex];
        setEditingField(field.key);
        setEditingValue(String(userConfig[field.key] ?? ''));
        setScreen('api-input');
        return;
      }
      if (key.escape) {
        setScreen('menu');
      }
    }
  });

  function handleMenuSelection(index: number): void {
    switch (MENU_OPTIONS[index]) {
      case 'View current resolved config':
        setScreen('view');
        return;
      case 'Set default mode':
        setModeIndex(Math.max(0, MODE_OPTIONS.indexOf(userConfig.mode ?? 'default')));
        setScreen('mode');
        return;
      case 'Edit allowed tools list':
        setEditingField('allowed_tools');
        setEditingValue((userConfig.allowed_tools ?? []).join(', '));
        setScreen('allowed');
        return;
      case 'Edit blocked tools list':
        setEditingField('disallowed_tools');
        setEditingValue((userConfig.disallowed_tools ?? []).join(', '));
        setScreen('blocked');
        return;
      case 'Set/update API keys':
        setScreen('api-select');
        return;
      case 'Exit':
        onExit();
        return;
      default:
        return;
    }
  }

  function saveConfig(nextConfig: Partial<IrisConfig>): void {
    writeUserConfig(nextConfig);
    setUserConfig(nextConfig);
    setStatus('Saved ~/.iris/config.toml');
  }

  function handleListSubmit(field: 'allowed_tools' | 'disallowed_tools', value: string): void {
    const items = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    saveConfig({
      ...userConfig,
      [field]: items.length > 0 ? items : undefined,
    });
    setScreen('menu');
  }

  function handleApiSubmit(value: string): void {
    if (!editingField) {
      setScreen('menu');
      return;
    }

    saveConfig({
      ...userConfig,
      [editingField]: value.trim() || undefined,
    });
    setEditingField(null);
    setEditingValue('');
    setScreen('api-select');
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>IrisCode config</Text>
      {status ? <Text color="green">{status}</Text> : null}

      {screen === 'menu' ? (
        <Box flexDirection="column" marginTop={1}>
          {MENU_OPTIONS.map((option, index) => (
            <Text key={option} color={index === menuIndex ? 'cyan' : undefined}>
              {`${index === menuIndex ? '›' : ' '} ${option}`}
            </Text>
          ))}
          <Text color="gray">Enter to select, q to quit</Text>
        </Box>
      ) : null}

      {screen === 'view' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Resolved config</Text>
          {JSON.stringify({
            mode: resolvedConfig.mode,
            defaultModel: resolvedConfig.defaultModel,
            logLevel: resolvedConfig.logLevel,
            allowed_tools: resolvedConfig.allowed_tools,
            disallowed_tools: resolvedConfig.disallowed_tools,
            rules: resolvedRules,
          }, null, 2).split('\n').map((line, index) => (
            <Text key={index} color="gray">{line}</Text>
          ))}
          <Text color="gray">Esc or b to go back</Text>
        </Box>
      ) : null}

      {screen === 'mode' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Select default mode</Text>
          {MODE_OPTIONS.map((mode, index) => (
            <Text key={mode} color={index === modeIndex ? 'cyan' : undefined}>
              {`${index === modeIndex ? '›' : ' '} ${mode}`}
            </Text>
          ))}
          <Text color="gray">Enter to save, Esc to cancel</Text>
        </Box>
      ) : null}

      {screen === 'allowed' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Edit allowed tools</Text>
          <Text color="gray">Comma-separated tool patterns</Text>
          <TextInput
            value={editingValue}
            onChange={setEditingValue}
            onSubmit={(value) => handleListSubmit('allowed_tools', value)}
          />
        </Box>
      ) : null}

      {screen === 'blocked' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Edit blocked tools</Text>
          <Text color="gray">Comma-separated tool patterns</Text>
          <TextInput
            value={editingValue}
            onChange={setEditingValue}
            onSubmit={(value) => handleListSubmit('disallowed_tools', value)}
          />
        </Box>
      ) : null}

      {screen === 'api-select' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Select API key to edit</Text>
          {API_KEY_FIELDS.map((field, index) => (
            <Text key={field.label} color={index === apiIndex ? 'cyan' : undefined}>
              {`${index === apiIndex ? '›' : ' '} ${field.label}`}
            </Text>
          ))}
          <Text color="gray">Enter to edit, Esc to go back</Text>
        </Box>
      ) : null}

      {screen === 'api-input' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{API_KEY_FIELDS.find((field) => field.key === editingField)?.label ?? 'Edit value'}</Text>
          <Text color="gray">Press enter to save. Leave blank to clear.</Text>
          <TextInput value={editingValue} onChange={setEditingValue} onSubmit={handleApiSubmit} />
        </Box>
      ) : null}
    </Box>
  );
}
