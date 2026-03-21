#!/usr/bin/env bun
import React, { useState, useRef, useCallback } from 'react';
import { render, Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { loadConfig } from '../config/loader.ts';
import { createDefaultRegistry, parseModelString } from '../models/registry.ts';
import { ToolRegistry } from '../tools/index.ts';
import { ReadFileTool } from '../tools/file/read.ts';
import { WriteFileTool } from '../tools/file/write.ts';
import { EditFileTool } from '../tools/file/edit.ts';
import { BashTool } from '../tools/shell/bash.ts';
import { GlobTool } from '../tools/search/glob.ts';
import { GrepTool } from '../tools/search/grep.ts';
import { PermissionsEngine } from '../permissions/engine.ts';
import { runAgentLoop } from '../agent/loop.ts';
import { logger } from '../shared/logger.ts';
import type { Message } from '../shared/types.ts';

// ---------- Parse CLI args ----------
const args = process.argv.slice(2);
let modelOverride: string | undefined;
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--model' || args[i] === '-m') && args[i + 1]) {
    modelOverride = args[++i];
  }
}

// ---------- Bootstrap ----------
const config = loadConfig();
logger.setLevel(config.logLevel as Parameters<typeof logger.setLevel>[0]);

const modelString = modelOverride ?? config.defaultModel;

// ---------- Tool registry ----------
function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new BashTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  return registry;
}

// ---------- Chat message type for UI ----------
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

// ---------- App component ----------
function App({ modelLabel }: { modelLabel: string }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', text: `IrisCode — model: ${modelLabel}` },
  ]);
  const [running, setRunning] = useState(false);
  const historyRef = useRef<Message[]>([]);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);

      historyRef.current.push({ role: 'user', content: trimmed });
      setRunning(true);

      try {
        const modelRegistry = await createDefaultRegistry();
        const { provider, modelId } = parseModelString(modelString);
        const key = `${provider}/${modelId}`;
        const adapter = modelRegistry.get(key);

        const tools = buildToolRegistry();
        const permissions = new PermissionsEngine('default');

        let assistantOutput = '';
        await runAgentLoop(historyRef.current, {
          adapter,
          tools,
          permissions,
          maxIterations: 10,
          onText: (text) => {
            assistantOutput += text;
          },
          onToolRequest: async (toolName) => {
            setMessages((prev) => [
              ...prev,
              { role: 'system', text: `[Requesting permission: ${toolName}]` },
            ]);
            return true; // auto-approve in CLI for now
          },
        });

        setMessages((prev) => [...prev, { role: 'assistant', text: assistantOutput }]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [...prev, { role: 'system', text: `Error: ${msg}` }]);
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  return (
    <Box flexDirection="column" padding={1}>
      {messages.map((m, i) => (
        <Box key={i} marginBottom={1}>
          <Text
            color={m.role === 'user' ? 'cyan' : m.role === 'system' ? 'yellow' : 'white'}
            bold={m.role === 'user'}
          >
            {m.role === 'user' ? '> ' : m.role === 'system' ? '• ' : '  '}
            {m.text}
          </Text>
        </Box>
      ))}
      {running ? (
        <Text color="gray">thinking...</Text>
      ) : (
        <Box>
          <Text color="cyan" bold>{'> '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Ask anything..."
          />
        </Box>
      )}
    </Box>
  );
}

// ---------- Entry ----------
const modelLabel = modelString;
render(<App modelLabel={modelLabel} />);
