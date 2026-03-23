import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'warn';

function getDebugLogPath(): string {
  const directory = resolve(process.env.HOME ?? homedir(), '.iris');
  mkdirSync(directory, { recursive: true });
  return join(directory, 'debug.log');
}

function writeDebugLog(message: string): void {
  try {
    appendFileSync(getDebugLogPath(), `${message}\n`, 'utf-8');
  } catch {
    // Debug logging must never interfere with primary execution paths.
  }
}

function log(level: LogLevel, ...args: unknown[]): void {
  const prefix = `[iriscode:${level}]`;
  const message = `${prefix} ${args.map(String).join(' ')}`;

  if (level === 'debug') {
    writeDebugLog(message);
    return;
  }

  if (LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]) {
    process.stderr.write(`${message}\n`);
  }
}

export const logger = {
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },
  debug(...args: unknown[]): void {
    log('debug', ...args);
  },
  info(...args: unknown[]): void {
    log('info', ...args);
  },
  warn(...args: unknown[]): void {
    log('warn', ...args);
  },
  error(...args: unknown[]): void {
    log('error', ...args);
  },
};
