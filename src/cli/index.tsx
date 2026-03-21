#!/usr/bin/env bun
import React, { useCallback, useRef, useState } from 'react';
import { render, Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { runAgentLoop, type ToolPermissionChoice } from '../agent/loop.ts';
import { runSubagentTask } from '../agent/orchestrator.ts';
import { buildDefaultSystemPrompt } from '../agent/system-prompt.ts';
import { loadConfig } from '../config/loader.ts';
import { costTracker } from '../cost/tracker.ts';
import { createDefaultRegistry as createModelRegistry, parseModelString } from '../models/registry.ts';
import { PermissionEngine } from '../permissions/engine.ts';
import type { PermissionMode, PermissionRequest, PermissionResult } from '../permissions/types.ts';
import { logger } from '../shared/logger.ts';
import type { Message } from '../shared/types.ts';
import { PermissionPrompt } from '../ui/components/permission-prompt.tsx';
import { runConfigCommand } from './commands/config.ts';
import { runCostCommand } from './commands/cost.ts';
import { runModelsCommand } from './commands/models.ts';
import { runRunCommand } from './commands/run.ts';
import {
  createDefaultRegistry as createToolRegistry,
  type LoadedSkill,
} from '../tools/index.ts';

const args = process.argv.slice(2);
const subcommand = args[0];

let modelOverride: string | undefined;
let modeOverride: PermissionMode | undefined;
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--model' || args[i] === '-m') && args[i + 1]) {
    modelOverride = args[++i];
    continue;
  }
  if (args[i] === '--mode' && args[i + 1]) {
    const value = args[++i];
    if (value === 'default' || value === 'acceptEdits' || value === 'plan') {
      modeOverride = value;
    }
  }
}

if (subcommand === 'models') {
  await runModelsCommand();
  process.exit(0);
}

if (subcommand === 'cost') {
  runCostCommand();
  process.exit(0);
}

if (subcommand === 'config') {
  await runConfigCommand(process.cwd());
  process.exit(0);
}

if (subcommand === 'run') {
  try {
    await runRunCommand(args.slice(1), { modelOverride, modeOverride });
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

const config = loadConfig();
logger.setLevel(config.logLevel as Parameters<typeof logger.setLevel>[0]);

const modelString = modelOverride ?? config.defaultModel;
const resolvedMode: PermissionMode = modeOverride ?? config.mode ?? 'default';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

interface PendingPermissionPrompt {
  request: PermissionRequest;
  result: PermissionResult;
  resolve: (choice: ToolPermissionChoice) => void;
}

function App({ modelLabel, initialMode }: { modelLabel: string; initialMode: PermissionMode }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', text: `IrisCode — model: ${modelLabel} — mode: ${formatModeLabel(initialMode)}` },
  ]);
  const [running, setRunning] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermissionPrompt | null>(null);
  const [questionInput, setQuestionInput] = useState('');
  const historyRef = useRef<Message[]>([]);
  const loadedSkillsRef = useRef<LoadedSkill[]>([]);
  const permissionsRef = useRef(new PermissionEngine(initialMode, process.cwd()));
  const sessionIdRef = useRef(globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`);
  const pendingQuestionResolverRef = useRef<((answer: string) => void) | null>(null);

  const askUser = useCallback(async (question: string): Promise<string> => {
    if (pendingQuestionResolverRef.current) {
      throw new Error('Another ask-user prompt is already active');
    }

    return new Promise<string>((resolve) => {
      pendingQuestionResolverRef.current = resolve;
      setQuestionInput('');
      setPendingQuestion(question);
    });
  }, []);

  const requestPermission = useCallback(
    async (request: PermissionRequest, result: PermissionResult): Promise<ToolPermissionChoice> => {
      return new Promise<ToolPermissionChoice>((resolve) => {
        setPendingPermission({ request, result, resolve });
      });
    },
    [],
  );

  const handleQuestionSubmit = useCallback((value: string) => {
    const resolve = pendingQuestionResolverRef.current;
    if (!resolve) {
      return;
    }

    pendingQuestionResolverRef.current = null;
    setPendingQuestion(null);
    setQuestionInput('');
    setMessages((prev) => [...prev, { role: 'system', text: `[User input] ${value}` }]);
    resolve(value);
  }, []);

  const handlePermissionChoice = useCallback((choice: ToolPermissionChoice) => {
    setPendingPermission((current) => {
      if (!current) {
        return current;
      }

      current.resolve(choice);
      return null;
    });
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }

      setInput('');
      setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
      historyRef.current.push({ role: 'user', content: trimmed });
      setRunning(true);

      try {
        const modelRegistry = await createModelRegistry();
        const { provider, modelId } = parseModelString(modelString);
        const modelKey = `${provider}/${modelId}`;
        const adapter = modelRegistry.get(modelKey);
        const tools = createToolRegistry({ currentModel: modelKey });
        const baseSystemPrompt = buildDefaultSystemPrompt(
          true,
          tools.getDefinitions().map((tool) => tool.name),
        );

        let assistantOutput = '';
        const result = await runAgentLoop(historyRef.current, {
          adapter,
          tools,
          permissions: permissionsRef.current,
          modelRegistry,
          maxIterations: 10,
          cwd: process.cwd(),
          sessionId: sessionIdRef.current,
          systemPrompt: baseSystemPrompt,
          costTracker,
          loadedSkills: loadedSkillsRef.current,
          subagentDepth: 0,
          askUser,
          runSubagent: (description, model) =>
            runSubagentTask(
              description,
              {
                currentModel: modelKey,
                modelRegistry,
                permissions: permissionsRef.current,
                cwd: process.cwd(),
                askUser,
                costTracker,
                loadedSkills: loadedSkillsRef.current,
                sessionId: sessionIdRef.current,
                onInfo: (text) => {
                  setMessages((prev) => [...prev, { role: 'system', text }]);
                },
                onPermissionPrompt: requestPermission,
              },
              model,
            ),
          onText: (text) => {
            assistantOutput += text;
          },
          onInfo: (text) => {
            setMessages((prev) => [...prev, { role: 'system', text }]);
          },
          onPermissionPrompt: requestPermission,
        });

        costTracker.add(provider, modelId, result.totalInputTokens, result.totalOutputTokens);
        setSessionCost(costTracker.total().costUsd);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: assistantOutput || result.finalText || '(no response)' },
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [...prev, { role: 'system', text: `Error: ${message}` }]);
      } finally {
        pendingQuestionResolverRef.current = null;
        setPendingQuestion(null);
        setPendingPermission(null);
        setQuestionInput('');
        setRunning(false);
      }
    },
    [askUser, modelString, requestPermission],
  );

  return (
    <Box flexDirection="column" padding={1}>
      {messages.map((message, index) => (
        <Box key={index} marginBottom={1}>
          <Text
            color={message.role === 'user' ? 'cyan' : message.role === 'system' ? 'yellow' : 'white'}
            bold={message.role === 'user'}
          >
            {message.role === 'user' ? '> ' : message.role === 'system' ? '• ' : '  '}
            {message.text}
          </Text>
        </Box>
      ))}

      {pendingQuestion ? (
        <Box flexDirection="column">
          <Text color="yellow">{pendingQuestion}</Text>
          <Box>
            <Text color="cyan" bold>{'> '}</Text>
            <TextInput
              value={questionInput}
              onChange={setQuestionInput}
              onSubmit={handleQuestionSubmit}
              placeholder="Type your answer..."
            />
          </Box>
        </Box>
      ) : pendingPermission ? (
        <PermissionPrompt
          request={pendingPermission.request}
          onSelect={handlePermissionChoice}
        />
      ) : running ? (
        <Text color="gray">thinking...</Text>
      ) : (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan" bold>{'> '}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Ask anything..."
            />
          </Box>
          {sessionCost > 0 ? (
            <Text color="gray" dimColor>
              {`  session cost: $${sessionCost.toFixed(6)}`}
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

function formatModeLabel(mode: PermissionMode): string {
  return mode === 'plan' ? 'plan (dry run)' : mode;
}

render(<App modelLabel={modelString} initialMode={resolvedMode} />);
