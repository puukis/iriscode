import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { ZodError } from 'zod';
import {
  type PermissionsConfig,
  ProjectConfigSchema,
  type ProjectConfig,
} from './schema.ts';
import {
  ensureDirectory,
  formatValidationError,
  isPlainObject,
  mergeConfigObjects,
  normalizeConfigInput,
} from './utils.ts';
import { createLoadedContextFile, type LoadedContextFile } from './context-files.ts';

export const PROJECT_CONTEXT_FILE = 'IRIS.md';
export const PROJECT_STATE_DIR = '.iris';
export const PROJECT_RULES_DIR = '.iris/rules';
export const PROJECT_MEMORY_DIR = '.iris/memory';
export const PROJECT_SETTINGS_FILE = 'settings.local.json';
const PROJECT_GITIGNORE_FILE = '.gitignore';

const DEFAULT_PROJECT_TEMPLATE = `# Project Name

Describe your project here. This text is injected into the agent's context at the start of every session.

## Config

\`\`\`yaml
# model: anthropic/claude-sonnet-4-6
# permissions:
#   mode: default
#   allowed_tools: [read, write, edit, bash, glob, grep]
#   disallowed_tools: []
# memory:
#   max_tokens: 10000
\`\`\`
`;

const DEFAULT_PROJECT_STATE = {
  permissions: {
    allow: [] as string[],
    deny: [] as string[],
  },
};

export interface LoadedProjectConfig {
  config: ProjectConfig;
  contextText: string;
  contextFiles: LoadedContextFile[];
}

interface ParsedMarkdownConfig {
  config: Record<string, unknown>;
  contextText: string;
}

export async function loadProjectConfig(cwd: string = process.cwd()): Promise<LoadedProjectConfig> {
  return loadProjectConfigSync(cwd);
}

export function loadProjectConfigSync(cwd: string = process.cwd()): LoadedProjectConfig {
  const projectRoot = resolve(cwd);
  const rootConfigPath = resolve(projectRoot, PROJECT_CONTEXT_FILE);
  const hadRootConfig = existsSync(rootConfigPath);
  ensureProjectContext(projectRoot);
  const memoryFiles = loadProjectMemoryFilesSync(projectRoot);
  const memoryContext = memoryFiles.length > 0
    ? ['Persisted project memory:', ...memoryFiles.map((file) => `- ${file.text}`)].join('\n')
    : '';

  if (!hadRootConfig) {
    const validation = ProjectConfigSchema.safeParse(
      normalizeConfigInput(projectStateToProjectConfig(loadProjectSettingsStateSync(projectRoot))),
    );
    if (!validation.success) {
      throw new Error(formatValidationError('Project config', validation.error));
    }

    return {
      config: validation.data,
      contextText: memoryContext,
      contextFiles: memoryFiles,
    };
  }

  const files = collectProjectConfigFiles(projectRoot);
  let mergedConfig: Record<string, unknown> = {};
  const contextParts: string[] = [];
  const contextFiles: LoadedContextFile[] = [];

  for (const filePath of files) {
    const parsed = parseProjectMarkdownFile(filePath);
    mergedConfig = mergeConfigObjects(mergedConfig, parsed.config);
    if (parsed.contextText) {
      contextParts.push(parsed.contextText);
      const contextFile = createLoadedContextFile(filePath, parsed.contextText);
      if (contextFile) {
        contextFiles.push(contextFile);
      }
    }
  }

  const mergedWithState = mergeConfigObjects(
    mergedConfig,
    projectStateToProjectConfig(loadProjectSettingsStateSync(projectRoot)),
  );

  const validation = ProjectConfigSchema.safeParse(normalizeConfigInput(mergedWithState));
  if (!validation.success) {
    throw new Error(formatValidationError('Project config', validation.error));
  }

  return {
    config: validation.data,
    contextText: [...contextParts.filter(Boolean), memoryContext].filter(Boolean).join('\n\n'),
    contextFiles: [...contextFiles, ...memoryFiles],
  };
}

export function ensureProjectContext(cwd: string): void {
  const projectRoot = resolve(cwd);
  const stateDir = ensureDirectory(join(projectRoot, PROJECT_STATE_DIR));
  const rulesDir = ensureDirectory(join(projectRoot, PROJECT_RULES_DIR));
  const memoryDir = ensureDirectory(join(projectRoot, PROJECT_MEMORY_DIR));
  void rulesDir;
  void memoryDir;

  const gitignorePath = join(stateDir, PROJECT_GITIGNORE_FILE);
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*\n', 'utf-8');
  }

  const settingsPath = join(stateDir, PROJECT_SETTINGS_FILE);
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, `${JSON.stringify(DEFAULT_PROJECT_STATE, null, 2)}\n`, 'utf-8');
  }

  const irisPath = join(projectRoot, PROJECT_CONTEXT_FILE);
  if (!existsSync(irisPath)) {
    writeFileSync(irisPath, DEFAULT_PROJECT_TEMPLATE, 'utf-8');
  }
}

export function addProjectAllowedTool(cwd: string, pattern: string): void {
  updateProjectPermissionState(cwd, 'allow', pattern);
}

export function addProjectBlockedTool(cwd: string, pattern: string): void {
  updateProjectPermissionState(cwd, 'deny', pattern);
}

export function loadProjectStatePermissionsSync(cwd: string): PermissionsConfig {
  const state = loadProjectSettingsStateSync(cwd);
  const permissions = state.permissions;
  return {
    allowed_tools: Array.isArray(permissions.allow) ? [...permissions.allow] : [],
    disallowed_tools: Array.isArray(permissions.deny) ? [...permissions.deny] : [],
  };
}

function updateProjectPermissionState(
  cwd: string,
  key: 'allow' | 'deny',
  pattern: string,
): void {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return;
  }

  const absoluteCwd = resolve(cwd);
  ensureProjectContext(absoluteCwd);
  const state = loadProjectSettingsStateSync(absoluteCwd);
  const existing = key === 'allow' ? state.permissions.allow : state.permissions.deny;
  if (!existing.includes(trimmedPattern)) {
    existing.push(trimmedPattern);
  }
  writeProjectSettingsStateSync(absoluteCwd, state);
}

function collectProjectConfigFiles(projectRoot: string): string[] {
  const files = new Set<string>();
  const rootConfig = resolve(projectRoot, PROJECT_CONTEXT_FILE);
  if (existsSync(rootConfig)) {
    files.add(rootConfig);
  }

  for (const path of walkDirectory(projectRoot)) {
    const relativePath = relative(projectRoot, path);
    if (relativePath === PROJECT_CONTEXT_FILE) {
      continue;
    }

    if (relativePath.endsWith(`/${PROJECT_CONTEXT_FILE}`) || relativePath.endsWith(`\\${PROJECT_CONTEXT_FILE}`)) {
      files.add(path);
    }
  }

  const rulesDir = resolve(projectRoot, PROJECT_RULES_DIR);
  if (existsSync(rulesDir)) {
    for (const path of walkDirectory(rulesDir)) {
      if (path.endsWith('.md')) {
        files.add(path);
      }
    }
  }

  return Array.from(files).sort(compareSpecificity(projectRoot));
}

function compareSpecificity(projectRoot: string) {
  return (left: string, right: string): number => {
    const leftRelative = relative(projectRoot, left);
    const rightRelative = relative(projectRoot, right);
    const leftDepth = depthOf(leftRelative);
    const rightDepth = depthOf(rightRelative);
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }
    return leftRelative.localeCompare(rightRelative);
  };
}

function depthOf(relativePath: string): number {
  return relativePath.split(/[\\/]/).filter(Boolean).length;
}

function walkDirectory(root: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') {
      continue;
    }
    if (root === resolve(root) && ['.git', 'node_modules', 'dist', 'build'].includes(entry.name)) {
      continue;
    }

    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === PROJECT_STATE_DIR && fullPath !== resolve(root, PROJECT_RULES_DIR)) {
        const nestedRulesDir = resolve(fullPath, 'rules');
        if (existsSync(nestedRulesDir)) {
          results.push(...walkDirectory(nestedRulesDir));
        }
        continue;
      }

      results.push(...walkDirectory(fullPath));
      continue;
    }

    results.push(fullPath);
  }

  return results;
}

function parseProjectMarkdownFile(filePath: string): ParsedMarkdownConfig {
  const absolutePath = resolve(filePath);
  const content = readFileSync(absolutePath, 'utf-8');

  let workingContent = content;
  let configObject: Record<string, unknown> = {};

  const frontmatter = extractFrontmatter(content);
  if (frontmatter) {
    configObject = mergeConfigObjects(configObject, parseYamlConfig(frontmatter.yaml, absolutePath));
    workingContent = frontmatter.contextText;
  }

  const configSection = extractConfigSection(workingContent);
  if (configSection) {
    configObject = mergeConfigObjects(configObject, parseYamlConfig(configSection.yaml, absolutePath));
    workingContent = configSection.contextText;
  }

  const validation = ProjectConfigSchema.safeParse(normalizeConfigInput(configObject));
  if (!validation.success) {
    throw new Error(formatValidationError(`Project config in ${absolutePath}`, validation.error));
  }

  return {
    config: validation.data,
    contextText: workingContent,
  };
}

function parseYamlConfig(yamlSource: string, filePath: string): Record<string, unknown> {
  if (!yamlSource.trim()) {
    return {};
  }

  try {
    const parsed = parseYaml(yamlSource);
    if (!isPlainObject(parsed)) {
      return {};
    }
    return normalizeConfigInput(parsed);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const line = error.linePos?.[0]?.line;
      const column = error.linePos?.[0]?.col;
      throw new Error(
        `Invalid YAML in ${filePath}${line ? `:${line}${column ? `:${column}` : ''}` : ''}: ${error.message}`,
      );
    }

    if (error instanceof ZodError) {
      throw new Error(formatValidationError(`Project config in ${filePath}`, error));
    }

    throw error;
  }
}

function extractFrontmatter(content: string): { yaml: string; contextText: string } | null {
  if (!content.startsWith('---\n')) {
    return null;
  }

  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return null;
  }

  const yaml = content.slice(4, endIndex);
  const contextText = content.slice(endIndex + '\n---\n'.length);
  return { yaml, contextText };
}

function extractConfigSection(content: string): { yaml: string; contextText: string } | null {
  const match = content.match(/^## Config\s*\n+```ya?ml\s*\n([\s\S]*?)\n```\s*$/m);
  if (!match || match.index === undefined) {
    return null;
  }

  const contextText = `${content.slice(0, match.index)}${content.slice(match.index + match[0].length)}`;
  return {
    yaml: match[1],
    contextText,
  };
}

function loadProjectSettingsStateSync(cwd: string): typeof DEFAULT_PROJECT_STATE {
  const absoluteCwd = resolve(cwd);
  ensureProjectContext(absoluteCwd);
  const settingsPath = resolve(absoluteCwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE);

  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return structuredClone(DEFAULT_PROJECT_STATE);
    }

    const permissions = isPlainObject(parsed.permissions) ? parsed.permissions : {};
    return {
      permissions: {
        allow: toStringArray(permissions.allow),
        deny: toStringArray(permissions.deny),
      },
    };
  } catch {
    return structuredClone(DEFAULT_PROJECT_STATE);
  }
}

function loadProjectMemoryFilesSync(projectRoot: string): LoadedContextFile[] {
  const memoryDir = resolve(projectRoot, PROJECT_MEMORY_DIR);
  if (!existsSync(memoryDir)) {
    return [];
  }

  return walkProjectMemoryFiles(memoryDir)
    .map((filePath) => formatMemoryEntry(projectRoot, filePath))
    .filter((entry): entry is LoadedContextFile => entry !== null);
}

function walkProjectMemoryFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') {
      continue;
    }

    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkProjectMemoryFiles(fullPath));
      continue;
    }

    if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function formatMemoryEntry(projectRoot: string, filePath: string): LoadedContextFile | null {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size === 0 || stats.size > 64 * 1024) {
      return null;
    }

    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content || content.includes('\u0000')) {
      return null;
    }

    const relativePath = relative(projectRoot, filePath);
    const label = relativePath
      .replace(/^\.iris[\\/]+memory[\\/]+/i, '')
      .replace(/\.[^.]+$/, '')
      .split(/[\\/]/)
      .flatMap((segment) => segment.split(/[-_]+/))
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');

    const oneLineContent = content.replace(/\s+/g, ' ').trim();
    const summary = oneLineContent.length > 240
      ? `${oneLineContent.slice(0, 237)}...`
      : oneLineContent;

    return createLoadedContextFile(
      relativePath,
      `${label || relativePath} (${relativePath}): ${summary}`,
    );
  } catch {
    return null;
  }
}

function writeProjectSettingsStateSync(cwd: string, state: typeof DEFAULT_PROJECT_STATE): void {
  const absoluteCwd = resolve(cwd);
  ensureProjectContext(absoluteCwd);
  const settingsPath = resolve(absoluteCwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function projectStateToProjectConfig(state: typeof DEFAULT_PROJECT_STATE): Record<string, unknown> {
  const permissions: Record<string, unknown> = {};
  if (state.permissions.allow.length > 0) {
    permissions.allowed_tools = [...state.permissions.allow];
  }
  if (state.permissions.deny.length > 0) {
    permissions.disallowed_tools = [...state.permissions.deny];
  }

  return Object.keys(permissions).length > 0
    ? { permissions }
    : {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
