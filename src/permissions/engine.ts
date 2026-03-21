import type { PermissionMode } from '../shared/types.ts';
import { PermissionDeniedError } from '../shared/errors.ts';

/**
 * Tools that are always allowed regardless of mode.
 */
const ALWAYS_ALLOWED = new Set([
  'read_file',
  'glob',
  'grep',
]);

/**
 * Tools that require explicit approval in 'default' mode.
 */
const REQUIRES_APPROVAL = new Set([
  'write_file',
  'edit_file',
  'bash',
]);

export class PermissionsEngine {
  private mode: PermissionMode;

  constructor(mode: PermissionMode = 'default') {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * Check whether a tool execution is permitted.
   * Throws PermissionDeniedError if denied.
   * Returns true if allowed automatically (no prompt needed).
   * Returns false if the tool requires a user prompt (caller must ask).
   */
  check(toolName: string): boolean {
    if (this.mode === 'rejectAll') {
      throw new PermissionDeniedError(toolName);
    }

    if (this.mode === 'acceptAll') {
      return true;
    }

    // default mode
    if (ALWAYS_ALLOWED.has(toolName)) {
      return true;
    }

    if (REQUIRES_APPROVAL.has(toolName)) {
      return false; // caller must prompt the user
    }

    // Unknown tools require approval in default mode
    return false;
  }

  /**
   * Convenience: throw if the tool is not allowed, handling the "needs prompt" case
   * as auto-denied (useful in non-interactive contexts).
   */
  checkOrThrow(toolName: string): void {
    const allowed = this.check(toolName);
    if (!allowed) {
      throw new PermissionDeniedError(toolName);
    }
  }
}
