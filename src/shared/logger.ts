export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'warn';

function log(level: LogLevel, ...args: unknown[]): void {
  if (LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]) {
    const prefix = `[iriscode:${level}]`;
    process.stderr.write(`${prefix} ${args.map(String).join(' ')}\n`);
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
