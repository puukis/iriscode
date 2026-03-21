import { watch, type FSWatcher } from 'fs';
import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { reloadConfig } from './loader.ts';
import { PROJECT_CONTEXT_FILE } from './project.ts';
import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE } from './global.ts';
import { bus } from '../shared/events.ts';

const DEBOUNCE_MS = 500;

export function startConfigWatcher(cwd: string = process.cwd()): () => void {
  const absoluteCwd = resolve(cwd);
  const paths = new Set<string>([
    dirname(resolve(absoluteCwd, PROJECT_CONTEXT_FILE)),
    dirname(resolve(absoluteCwd, '.env')),
    dirname(resolve(absoluteCwd, '.env.local')),
    resolve(process.env.HOME ?? homedir(), GLOBAL_CONFIG_DIR),
  ]);

  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const handleChange = (filename?: string | Buffer | null) => {
    const basename = typeof filename === 'string' ? filename : filename?.toString() ?? '';
    if (
      basename &&
      ![
        PROJECT_CONTEXT_FILE,
        '.env',
        '.env.local',
        GLOBAL_CONFIG_FILE,
        'IRIS.md',
      ].includes(basename)
    ) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      void reloadConfig(absoluteCwd)
        .then((config) => {
          bus.emit('config:reloaded', { config });
        })
        .catch(() => {
          // reloadConfig already prints human-readable errors.
        });
    }, DEBOUNCE_MS);
  };

  for (const path of paths) {
    try {
      const watcher = watch(path, (_eventType, filename) => handleChange(filename));
      watcher.unref?.();
      watchers.push(watcher);
    } catch {
      // Ignore missing/unwatchable paths.
    }
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}
