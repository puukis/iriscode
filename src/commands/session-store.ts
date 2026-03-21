import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { ensureDirectory } from '../config/utils.ts';
import type { SessionSnapshot, SessionSnapshotSummary, SessionState } from './types.ts';

const PROJECT_STATE_DIR = '.iris';
const SESSION_DIR = 'sessions';
const GLOBAL_PROJECT_DIR = 'projects';

export function saveSessionSnapshot(cwd: string, session: SessionState): void {
  const snapshot = createSessionSnapshot(session);
  const filePath = getSessionSnapshotPath(cwd, session.id);
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
}

export function listSessionSnapshots(cwd: string): SessionSnapshotSummary[] {
  const sessionsDir = getProjectSessionsDir(cwd);
  if (!existsSync(sessionsDir)) {
    return [];
  }

  return readdirSync(sessionsDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const filePath = resolve(sessionsDir, entry);
      try {
        const snapshot = JSON.parse(readFileSync(filePath, 'utf-8')) as SessionSnapshot;
        return {
          id: snapshot.id,
          startedAt: snapshot.startedAt,
          messageCount: snapshot.messages.length,
          totalCostUsd: snapshot.totalCostUsd,
          model: snapshot.model,
          path: filePath,
        } satisfies SessionSnapshotSummary;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is SessionSnapshotSummary => entry !== null)
    .sort((left, right) => right.startedAt - left.startedAt);
}

export function loadSessionSnapshot(cwd: string, sessionId: string): SessionSnapshot | undefined {
  const filePath = getSessionSnapshotPath(cwd, sessionId);
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as SessionSnapshot;
  } catch {
    return undefined;
  }
}

export function saveSessionSummary(cwd: string, sessionId: string, summary: string): void {
  const summaryPath = getSummaryPath(cwd, sessionId);
  ensureDirectory(dirname(summaryPath));
  writeFileSync(summaryPath, summary.trimEnd() + '\n', 'utf-8');
}

export function loadSessionSummary(cwd: string, sessionId: string): string | undefined {
  const summaryPath = getSummaryPath(cwd, sessionId);
  if (!existsSync(summaryPath)) {
    return undefined;
  }

  try {
    return readFileSync(summaryPath, 'utf-8');
  } catch {
    return undefined;
  }
}

export function getSummaryPath(cwd: string, sessionId: string): string {
  const projectHash = hashProjectPath(cwd);
  return resolve(
    ensureDirectory(join(process.env.HOME ?? homedir(), '.iris', GLOBAL_PROJECT_DIR, projectHash, sessionId)),
    'summary.md',
  );
}

function createSessionSnapshot(session: SessionState): SessionSnapshot {
  return {
    id: session.id,
    startedAt: session.startedAt,
    model: session.model,
    permissionMode: session.permissionMode,
    totalInputTokens: session.totalInputTokens,
    totalOutputTokens: session.totalOutputTokens,
    totalCostUsd: session.costTracker.total().costUsd,
    costEntries: session.costTracker.total().entries,
    messages: structuredClone(session.messages),
    displayMessages: structuredClone(session.displayMessages),
  };
}

function getProjectSessionsDir(cwd: string): string {
  return resolve(ensureDirectory(join(cwd, PROJECT_STATE_DIR, SESSION_DIR)));
}

function getSessionSnapshotPath(cwd: string, sessionId: string): string {
  return resolve(getProjectSessionsDir(cwd), `${sessionId}.json`);
}

function hashProjectPath(cwd: string): string {
  return createHash('sha1').update(resolve(cwd)).digest('hex').slice(0, 12);
}
