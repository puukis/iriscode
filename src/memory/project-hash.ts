import { createHash } from 'crypto';
import { homedir } from 'os';
import { join, resolve } from 'path';

const GLOBAL_PROJECTS_DIR = join('.iris', 'projects');

/**
 * Returns a stable 12-char hex hash of the absolute project path.
 * Matches the algorithm used in session.ts and session-store.ts (SHA1, 12 chars).
 */
export function getProjectHash(cwd: string): string {
  return createHash('sha1').update(resolve(cwd)).digest('hex').slice(0, 12);
}

/**
 * Returns the global per-project directory: ~/.iris/projects/<hash>
 */
export function getProjectDir(cwd: string): string {
  const hash = getProjectHash(cwd);
  return resolve(process.env.HOME ?? homedir(), GLOBAL_PROJECTS_DIR, hash);
}

/**
 * Returns the per-session workspace directory: ~/.iris/projects/<hash>/<sessionId>
 * Used for summary.md and other per-session metadata (NOT the sessions/ JSON store).
 */
export function getSessionDir(cwd: string, sessionId: string): string {
  return resolve(getProjectDir(cwd), sessionId);
}
