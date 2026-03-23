import { addProjectAllowedTool, addProjectBlockedTool } from '../config/project.ts';
import { AllowedList } from './allowed-list.ts';
import { BlockedList } from './blocked-list.ts';
import { matchesToolPattern } from './matcher.ts';
import { isEditTool } from './modes.ts';
import { resolveRules } from './tiers.ts';
import type {
  PermissionMode,
  PermissionRequest,
  PermissionResult,
  PermissionTier,
  ToolPattern,
} from './types.ts';

export class PermissionEngine {
  private mode: PermissionMode;
  private readonly cwd: string;
  private readonly allowedList: AllowedList;
  private readonly blockedList: BlockedList;

  constructor(mode: PermissionMode = 'default', cwd: string = process.cwd()) {
    const rules = resolveRules(cwd);
    this.mode = mode;
    this.cwd = cwd;
    this.allowedList = new AllowedList(cwd, rules);
    this.blockedList = new BlockedList(cwd, rules);
  }

  async check(request: PermissionRequest): Promise<PermissionResult> {
    return this.checkSync(request);
  }

  checkSync(request: PermissionRequest): PermissionResult {
    if (matchesToolPattern(request, 'Skill')) {
      return {
        decision: 'allow',
        reason: 'The Skill dispatcher is always allowed.',
      };
    }

    const blockedRule = this.blockedList.match(request);
    if (blockedRule) {
      return {
        decision: 'deny',
        rule: blockedRule,
        reason: blockedRule.reason ?? `Tool "${request.toolName}" is blocked by configuration.`,
      };
    }

    const allowedRule = this.allowedList.match(request);
    if (allowedRule) {
      return {
        decision: 'allow',
        rule: allowedRule,
        reason: allowedRule.reason ?? `Tool "${request.toolName}" is on the allowlist.`,
      };
    }

    if (this.mode === 'plan') {
      return {
        decision: 'allow',
        reason: 'Plan mode is active. The agent loop will convert this tool call into a dry run.',
      };
    }

    if (this.mode === 'acceptEdits' && isEditTool(request.toolName)) {
      return {
        decision: 'allow',
        reason: 'acceptEdits mode auto-approves write and edit tools.',
      };
    }

    return {
      decision: 'prompt',
      reason: `Tool "${request.toolName}" requires approval.`,
    };
  }

  addAllowed(pattern: ToolPattern, tier: PermissionTier): void {
    this.allowedList.add(pattern, tier);
    if (tier === 'project') {
      addProjectAllowedTool(this.cwd, pattern);
    }
  }

  addBlocked(pattern: ToolPattern, tier: PermissionTier): void {
    this.blockedList.add(pattern, tier);
    if (tier === 'project') {
      addProjectBlockedTool(this.cwd, pattern);
    }
  }

  clearTier(tier: PermissionTier): void {
    this.allowedList.clearTier(tier);
    this.blockedList.clearTier(tier);
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }
}

export { PermissionEngine as PermissionsEngine };
