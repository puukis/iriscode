import { findMatchingRule } from './matcher.ts';
import { resolveRules } from './tiers.ts';
import type { PermissionRequest, PermissionRule, PermissionTier, ToolPattern } from './types.ts';

export class AllowedList {
  private rules: PermissionRule[];

  constructor(cwd: string, rules?: PermissionRule[]) {
    this.rules = (rules ?? resolveRules(cwd)).filter((rule) => rule.decision === 'allow');
  }

  isAllowed(request: PermissionRequest): boolean {
    return this.match(request) !== undefined;
  }

  match(request: PermissionRequest): PermissionRule | undefined {
    return findMatchingRule(this.rules, request, 'allow');
  }

  add(pattern: ToolPattern, tier: PermissionTier, reason?: string): void {
    this.rules.unshift({
      pattern,
      decision: 'allow',
      tier,
      reason: reason ?? 'Allowed for the current session',
    });
  }

  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  clearTier(tier: PermissionTier): void {
    this.rules = this.rules.filter((rule) => rule.tier !== tier);
  }
}
