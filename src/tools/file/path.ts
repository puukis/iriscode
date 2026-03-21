import { existsSync } from 'fs';
import { dirname, normalize, resolve } from 'path';

const PROJECT_CONTEXT_FILE = 'IRIS.md';
const PROJECT_STATE_DIR = '.iris';

export function resolveProjectFilePath(cwd: string, inputPath: string): string {
  if (!inputPath) {
    return resolve(cwd);
  }

  const normalizedInput = normalize(inputPath);
  if (normalizedInput.startsWith('/')) {
    return normalizedInput;
  }

  const projectStatePath = normalizeProjectStatePath(normalizedInput);
  if (projectStatePath) {
    const projectRoot = findProjectRoot(cwd);
    return resolve(projectRoot, projectStatePath);
  }

  return resolve(cwd, normalizedInput);
}

function normalizeProjectStatePath(inputPath: string): string | null {
  const normalized = inputPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const match = normalized.match(/^(?:\.iris\/)+(.+)$/);
  if (match) {
    return `${PROJECT_STATE_DIR}/${match[1]}`;
  }

  if (normalized === PROJECT_STATE_DIR) {
    return PROJECT_STATE_DIR;
  }

  if (normalized.startsWith(`${PROJECT_STATE_DIR}/`)) {
    return normalized;
  }

  return null;
}

function findProjectRoot(cwd: string): string {
  let current = resolve(cwd);

  while (true) {
    if (
      existsSync(resolve(current, PROJECT_CONTEXT_FILE))
      || existsSync(resolve(current, PROJECT_STATE_DIR))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(cwd);
    }
    current = parent;
  }
}
