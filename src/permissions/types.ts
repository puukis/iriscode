export type PermissionMode = 'default' | 'acceptEdits' | 'plan';

export type PermissionDecision = 'allow' | 'deny' | 'prompt';

export type PermissionTier = 'project' | 'user' | 'global';

export type ToolPattern = string;

export interface PermissionRule {
  pattern: ToolPattern;
  decision: PermissionDecision;
  tier: PermissionTier;
  reason?: string;
}

export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
}

export interface PermissionResult {
  decision: PermissionDecision;
  rule?: PermissionRule;
  reason: string;
}
