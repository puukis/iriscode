import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { getProjectDir } from './project-hash.ts';

const MAX_LINES_PER_SOURCE = 100;
const MAX_MEMORY_FILE_LINES = 500;
const GLOBAL_MEMORY_PATH_PARTS = ['.iris', 'MEMORY.md'];

export interface MemoryContent {
  globalText: string;
  projectText: string;
  combined: string;
  totalLines: number;
}

function getGlobalMemoryPath(): string {
  return resolve(process.env.HOME ?? homedir(), ...GLOBAL_MEMORY_PATH_PARTS);
}

function getProjectMemoryPath(cwd: string): string {
  return resolve(getProjectDir(cwd), 'MEMORY.md');
}

function readCapped(filePath: string, maxLines: number): string {
  if (!existsSync(filePath)) {
    return '';
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(0, maxLines).join('\n').trim();
  } catch {
    return '';
  }
}

function ensureParent(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function trimToMaxLines(content: string, maxLines: number): string {
  const lines = content.split('\n').filter(Boolean);
  if (lines.length <= maxLines) {
    return content;
  }
  // Remove oldest entries (from the top)
  return lines.slice(lines.length - maxLines).join('\n') + '\n';
}

export async function loadMemory(cwd: string): Promise<MemoryContent> {
  const globalText = readCapped(getGlobalMemoryPath(), MAX_LINES_PER_SOURCE);
  const projectText = readCapped(getProjectMemoryPath(cwd), MAX_LINES_PER_SOURCE);

  const parts = [globalText, projectText].filter(Boolean);
  const combined = parts.join('\n');
  const totalLines = Math.min(
    200,
    combined.split('\n').filter(Boolean).length,
  );

  return { globalText, projectText, combined, totalLines };
}

export async function appendToMemory(
  cwd: string,
  content: string,
  scope: 'global' | 'project',
): Promise<void> {
  const filePath = scope === 'global' ? getGlobalMemoryPath() : getProjectMemoryPath(cwd);
  ensureParent(filePath);

  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const updated = trimToMaxLines(`${existing}${content}`, MAX_MEMORY_FILE_LINES);
  writeFileSync(filePath, updated, 'utf-8');
}

export async function writeMemory(
  cwd: string,
  content: string,
  scope: 'global' | 'project',
): Promise<void> {
  const filePath = scope === 'global' ? getGlobalMemoryPath() : getProjectMemoryPath(cwd);
  ensureParent(filePath);
  writeFileSync(filePath, content, 'utf-8');
}

export async function clearMemory(
  cwd: string,
  scope: 'global' | 'project' | 'all',
): Promise<void> {
  if (scope === 'global' || scope === 'all') {
    const filePath = getGlobalMemoryPath();
    if (existsSync(filePath)) {
      writeFileSync(filePath, '', 'utf-8');
    }
  }
  if (scope === 'project' || scope === 'all') {
    const filePath = getProjectMemoryPath(cwd);
    if (existsSync(filePath)) {
      writeFileSync(filePath, '', 'utf-8');
    }
  }
}
