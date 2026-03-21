import { appendContextText, buildSubagentSystemPrompt } from './system-prompt.ts';
import { runAgentLoop } from './loop.ts';
import type { ResolvedConfig } from '../config/schema.ts';
import { createDefaultRegistry as createModelRegistry, parseModelString } from '../models/registry.ts';
import { PermissionEngine } from '../permissions/engine.ts';
import { ToolError } from '../shared/errors.ts';
import type { Message } from '../shared/types.ts';
import { CostTracker } from '../cost/tracker.ts';
import { createDefaultRegistry as createToolRegistry, type LoadedSkill } from '../tools/index.ts';
import type { GraphTracker } from '../graph/tracker.ts';
import type { Orchestrator } from './orchestrator.ts';
import type { DiffInterceptor } from '../diff/interceptor.ts';

interface SubagentContextOptions {
  id: string;
  parentId: string | null;
  description: string;
  model: string;
  depth: number;
  config: ResolvedConfig;
  tracker: GraphTracker;
  permissionEngine: PermissionEngine;
  orchestrator: Orchestrator;
  cwd: string;
  loadedSkills?: LoadedSkill[];
  askUser?: (question: string) => Promise<string>;
  onInfo?: (text: string) => void;
  onPermissionPrompt?: Parameters<typeof runAgentLoop>[1]['onPermissionPrompt'];
  parentCostTracker?: CostTracker;
  diffInterceptor?: DiffInterceptor;
}

export class SubagentContext {
  readonly id: string;
  readonly parentId: string | null;
  readonly description: string;
  readonly model: string;
  readonly depth: number;
  readonly config: ResolvedConfig;
  readonly tracker: GraphTracker;
  readonly permissionEngine: PermissionEngine;
  readonly messages: Message[] = [];
  readonly costTracker: CostTracker;
  readonly cwd: string;
  private readonly orchestrator: Orchestrator;
  private readonly askUser?: SubagentContextOptions['askUser'];
  private readonly onInfo?: SubagentContextOptions['onInfo'];
  private readonly onPermissionPrompt?: SubagentContextOptions['onPermissionPrompt'];
  private readonly loadedSkills: LoadedSkill[];
  private readonly diffInterceptor?: DiffInterceptor;

  constructor(options: SubagentContextOptions) {
    this.id = options.id;
    this.parentId = options.parentId;
    this.description = options.description;
    this.model = options.model;
    this.depth = options.depth;
    this.config = options.config;
    this.tracker = options.tracker;
    this.permissionEngine = new PermissionEngine(options.permissionEngine.getMode(), options.cwd);
    this.orchestrator = options.orchestrator;
    this.askUser = options.askUser;
    this.onInfo = options.onInfo;
    this.onPermissionPrompt = options.onPermissionPrompt;
    this.loadedSkills = [...(options.loadedSkills ?? [])];
    this.cwd = options.cwd;
    this.diffInterceptor = options.diffInterceptor;
    this.costTracker = new CostTracker((entry) => {
      options.parentCostTracker?.recordEntry(entry);
    });

    if (this.depth >= 5) {
      throw new ToolError(
        'Maximum subagent depth of 5 reached. Cannot spawn further subagents.',
        'task',
      );
    }
  }

  async run(prompt: string): Promise<string> {
    try {
      const modelRegistry = await createModelRegistry(this.config);
      if (!modelRegistry.has(this.model)) {
        throw new ToolError(`Unknown subagent model "${this.model}"`, 'task');
      }

      const adapter = modelRegistry.get(this.model);
      const tools = createToolRegistry({
        currentModel: this.model,
        orchestrator: this.orchestrator,
        agentId: this.id,
        depth: this.depth,
        diffInterceptor: this.diffInterceptor,
      });
      const systemPrompt = appendContextText(
        buildSubagentSystemPrompt(
          true,
          tools.getDefinitions().map((tool) => tool.name),
        ),
        this.config.context_text,
      );

      this.messages.splice(0, this.messages.length, { role: 'user', content: prompt });
      const result = await runAgentLoop(this.messages, {
        adapter,
        tools,
        permissions: this.permissionEngine,
        modelRegistry,
        systemPrompt,
        cwd: this.cwd,
        costTracker: this.costTracker,
        loadedSkills: this.loadedSkills,
        askUser: this.askUser,
        onInfo: this.onInfo,
        onPermissionPrompt: this.onPermissionPrompt,
        orchestrator: this.orchestrator,
        tracker: this.tracker,
        agentId: this.id,
        parentAgentId: this.parentId,
        depth: this.depth,
        description: this.description,
      });

      const { provider, modelId } = parseModelString(this.model);
      this.costTracker.add(provider, modelId, result.totalInputTokens, result.totalOutputTokens);
      const finalText =
        result.finalText.trim() ||
        'Subagent finished without a final summary. Re-run the task with a more explicit reporting instruction.';
      this.tracker.agentFinished(this.id, finalText);
      return finalText;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.tracker.agentFailed(this.id, message);
      throw error;
    }
  }
}
