import React, { useEffect, useMemo, useRef, useState } from 'react';
import { render as inkRender } from 'ink';
import { Session } from '../agent/session.ts';
import type { ResolvedConfig } from '../config/schema.ts';
import type { LoadedMemoryFile, SessionSnapshotSummary } from '../commands/types.ts';
import { PermissionEngine } from '../permissions/engine.ts';
import type { PermissionMode } from '../permissions/types.ts';
import { DiffInterceptor } from '../diff/interceptor.ts';
import { DiffViewerController } from '../diff/controller.ts';
import { DiffStore } from '../diff/store.ts';
import type { CommandRegistry } from '../commands/registry.ts';
import type { GraphTracker } from '../graph/tracker.ts';
import { InputRouter } from './input-router.ts';
import { ErrorBoundary } from './services/error-boundary.tsx';
import { Splash } from './components/splash.tsx';
import { IrisContext, type IrisContextValue, type IrisMessage } from './context.ts';
import { REPL } from '../screens/REPL.tsx';
import { loadGlobalConfig, writeGlobalConfig } from '../config/global.ts';
import type { McpRegistry } from '../mcp/registry.ts';
import type { HookRegistry } from '../hooks/registry.ts';
import type { PluginLoadResult } from '../plugins/types.ts';
import type { SkillLoadResult } from '../skills/types.ts';
import type { BridgeServer } from '../bridge/server.ts';
import { attachBridgeRuntime } from '../bridge/server.ts';

interface AppProps {
  cwd: string;
  initialConfig: ResolvedConfig;
  initialMemoryFiles: LoadedMemoryFile[];
  modelOverride?: string;
  modeOverride?: PermissionMode;
  mcpRegistry: McpRegistry;
  skillResult: SkillLoadResult;
  hookRegistry: HookRegistry;
  pluginResult: PluginLoadResult;
  bridgeServer?: BridgeServer;
  onReady?: (sessionRef: { current: Session | null }) => void;
  onCompactionManagerReady?: (cm: import('../memory/compaction.ts').CompactionManager, registry: import('../models/registry.ts').ModelRegistry) => void;
}

export function App(props: AppProps) {
  const permissionEngineRef = useRef(new PermissionEngine(props.modeOverride ?? props.initialConfig.permissions.mode, props.cwd));
  const diffInterceptorRef = useRef(new DiffInterceptor(new DiffStore(), props.modeOverride ?? props.initialConfig.permissions.mode, new DiffViewerController()));
  const sessionRef = useRef<Session | null>(null);
  const commandRegistryRef = useRef<CommandRegistry | null>(null);
  const graphTrackerRef = useRef<GraphTracker | null>(null);
  const sessionPickerResolverRef = useRef<((session?: SessionSnapshotSummary) => void) | null>(null);
  const configRef = useRef(props.initialConfig);
  const runtime = useMemo(() => ({
    messagesRef: { current: [] as IrisMessage[] },
    modelRef: { current: props.modelOverride ?? props.initialConfig.model },
    modeRef: { current: props.modeOverride ?? props.initialConfig.permissions.mode },
    isStreamingRef: { current: false },
    isBusyRef: { current: false },
    sessionIdRef: { current: 'pending' },
    sendMessageRef: { current: async () => {} },
    sendCommandRef: { current: async () => 'passthrough' as const },
    cancelRef: { current: () => {} },
    exitRef: { current: async () => {} },
  }), [props.initialConfig.model, props.initialConfig.permissions.mode, props.modeOverride, props.modelOverride]);
  const inputRouterRef = useRef(new InputRouter(props.initialConfig.vim_mode));
  const [showSplash, setShowSplash] = useState(!props.initialConfig.shown_splash);

  useEffect(() => {
    const projectName = props.cwd.split('/').filter(Boolean).at(-1) ?? 'project';
    process.stdout.write(`\u001b]0;IrisCode - ${projectName}\u0007`);
  }, [props.cwd]);

  useEffect(() => {
    props.onReady?.(sessionRef);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!props.bridgeServer) {
      return;
    }

    attachBridgeRuntime({
      cwd: props.cwd,
      sessionRef,
      configRef,
      commandRegistryRef,
      graphTrackerRef,
      permissionEngineRef,
      runtime,
    });
  }, [props.bridgeServer, props.cwd, runtime]);

  const ctx = useMemo<IrisContextValue>(() => ({
    cwd: props.cwd,
    initialConfig: props.initialConfig,
    initialMemoryFiles: props.initialMemoryFiles,
    modelOverride: props.modelOverride,
    modeOverride: props.modeOverride,
    sessionRef,
    configRef,
    commandRegistryRef,
    permissionEngineRef,
    diffInterceptorRef,
    graphTrackerRef,
    inputRouterRef,
    mcpRegistry: props.mcpRegistry,
    skillResult: props.skillResult,
    hookRegistry: props.hookRegistry,
    pluginResult: props.pluginResult,
    runtime,
    sessionPickerResolverRef,
  }), [props]);

  return (
    <ErrorBoundary>
      <IrisContext.Provider value={ctx}>
        {showSplash ? (
          <Splash
            onDone={() => {
              setShowSplash(false);
              void markSplashShown();
            }}
          />
        ) : (
          <REPL {...props} />
        )}
      </IrisContext.Provider>
    </ErrorBoundary>
  );
}

async function markSplashShown(): Promise<void> {
  const globalConfig = loadGlobalConfig().then(({ config }) => config);
  const config = await globalConfig;
  writeGlobalConfig({
    ...config,
    shown_splash: true,
  });
}

if (process.stdout.isTTY) {
  process.stdout.write('\x1b[?2004h');
}

export function renderApp(element: React.ReactElement) {
  return inkRender(element, { exitOnCtrlC: false });
}
