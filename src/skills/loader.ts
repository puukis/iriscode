import { readdir, readFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve, sep } from 'path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { logger } from '../shared/logger.ts';
import type { Skill, SkillFrontmatter, SkillLoadResult } from './types.ts';
import { loadConfig } from '../config/loader.ts';

const SKILL_FILE = 'SKILL.md';

const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  allowed_tools: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  disable_model_invocation: z.boolean().optional(),
  tags: z.array(z.string().min(1)).optional(),
}).strict();

type SkillPriority = 0 | 1 | 2;

interface LoadedSkillRecord {
  skill: Skill;
  priority: SkillPriority;
  order: number;
}

interface SkillDirectoryDescriptor {
  directory: string;
  priority: SkillPriority;
  namespace?: string;
}

export async function loadSkills(cwd: string): Promise<SkillLoadResult> {
  const projectRoot = resolve(cwd);
  const projectSkillsDir = resolve(projectRoot, '.iris', 'skills');
  const projectPluginsDir = resolve(projectRoot, '.iris', 'plugins');
  const globalSkillsDir = join(process.env.HOME ?? homedir(), '.iris', 'skills');
  const globalPluginsDir = join(process.env.HOME ?? homedir(), '.iris', 'plugins');
  const errors: Array<{ path: string; error: string }> = [];
  const loaded = new Map<string, LoadedSkillRecord>();
  let order = 0;

  const directories = await Promise.all([
    discoverSkillDirectories(globalSkillsDir, 0, errors),
    discoverSkillDirectories(projectSkillsDir, 1, errors),
    discoverPluginSkillDirectories(globalPluginsDir, errors),
    discoverPluginSkillDirectories(projectPluginsDir, errors),
  ]);

  for (const descriptor of directories.flat()) {
    try {
      const skill = await loadSkillDirectory(descriptor.directory, descriptor.namespace);
      loaded.set(skill.frontmatter.name, {
        skill,
        priority: descriptor.priority,
        order: order++,
      });
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }
      errors.push({
        path: descriptor.directory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const skills = Array.from(loaded.values())
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.order - right.order;
    })
    .map((entry) => entry.skill);

  return buildSkillLoadResult(projectRoot, skills, errors);
}

export function getSkill(name: string, result: SkillLoadResult): Skill | undefined {
  const normalized = name.trim();
  if (!normalized) {
    return undefined;
  }

  const exact = result.skills.find((skill) => skill.frontmatter.name === normalized);
  if (exact) {
    return exact;
  }

  const fallbackMatches = result.skills.filter((skill) => {
    const parts = skill.frontmatter.name.split(':');
    return parts[parts.length - 1] === normalized;
  });

  return fallbackMatches.length === 1 ? fallbackMatches[0] : undefined;
}

export async function loadSkillDirectory(
  directory: string,
  namespace?: string,
): Promise<Skill> {
  const absoluteDirectory = resolve(directory);
  const skillPath = join(absoluteDirectory, SKILL_FILE);
  const content = await readFile(skillPath, 'utf-8');
  const { frontmatter, instructions } = parseSkillMarkdown(content, skillPath);

  return {
    frontmatter: {
      ...frontmatter,
      name: namespace ? `${namespace}:${frontmatter.name}` : frontmatter.name,
    },
    instructions,
    source: skillPath,
    baseDir: absoluteDirectory,
  };
}

export async function refreshSkillLoadResult(
  cwd: string,
  result: SkillLoadResult,
): Promise<SkillLoadResult> {
  const refreshed = await buildSkillLoadResult(resolve(cwd), [...result.skills], [...result.errors]);
  result.skills = refreshed.skills;
  result.availableSkills = refreshed.availableSkills;
  result.errors = refreshed.errors;
  result.characterBudgetUsed = refreshed.characterBudgetUsed;
  return result;
}

export function buildAvailableSkillsText(skills: Skill[]): string {
  return skills
    .map((skill) => `"${skill.frontmatter.name}": ${skill.frontmatter.description}`)
    .join('\n');
}

async function discoverSkillDirectories(
  rootDir: string,
  priority: SkillPriority,
  errors: SkillLoadResult['errors'],
): Promise<SkillDirectoryDescriptor[]> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        directory: resolve(rootDir, entry.name),
        priority,
      }));
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    errors.push({
      path: rootDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function discoverPluginSkillDirectories(
  pluginsDir: string,
  errors: SkillLoadResult['errors'],
): Promise<SkillDirectoryDescriptor[]> {
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const directories: SkillDirectoryDescriptor[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginRoot = resolve(pluginsDir, entry.name);
      try {
        const manifest = await readPluginManifest(pluginRoot);
        const skillsRoot = join(pluginRoot, 'skills');
        const skillEntries = await readdir(skillsRoot, { withFileTypes: true }).catch((error) => {
          if (isMissingPathError(error)) {
            return [];
          }
          throw error;
        });

        for (const skillEntry of skillEntries) {
          if (!skillEntry.isDirectory()) {
            continue;
          }

          const skillDirectory = resolve(skillsRoot, skillEntry.name);
          directories.push({
            directory: skillDirectory,
            priority: 2,
            namespace: manifest.name,
          });
        }
      } catch (error) {
        errors.push({
          path: pluginRoot,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return directories;
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    errors.push({
      path: pluginsDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function readPluginManifest(pluginRoot: string): Promise<{ name: string }> {
  const manifestPath = join(pluginRoot, '.iris-plugin', 'plugin.json');
  const content = await readFile(manifestPath, 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    throw new Error(`Invalid plugin manifest at ${manifestPath}: missing name`);
  }
  return { name: parsed.name.trim() };
}

function parseSkillMarkdown(
  content: string,
  sourcePath: string,
): { frontmatter: SkillFrontmatter; instructions: string } {
  if (!content.startsWith('---\n')) {
    throw new Error(`Skill at ${sourcePath} must start with YAML frontmatter`);
  }

  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    throw new Error(`Skill at ${sourcePath} has unterminated YAML frontmatter`);
  }

  const rawFrontmatter = content.slice(4, endIndex);
  const instructions = content.slice(endIndex + '\n---\n'.length).trim();
  if (!instructions) {
    throw new Error(`Skill at ${sourcePath} does not contain any instructions`);
  }

  const parsedFrontmatter = parseYaml(rawFrontmatter);
  const validation = SkillFrontmatterSchema.safeParse(parsedFrontmatter);
  if (!validation.success) {
    throw new Error(validation.error.issues.map((issue) => issue.message).join(', '));
  }

  return {
    frontmatter: validation.data,
    instructions,
  };
}

async function resolveSkillCharacterBudget(cwd: string): Promise<number> {
  try {
    const config = await loadConfig(cwd);
    const contextWindowSize = estimateContextWindowSize(config.model);
    return Math.max(16_000, Math.floor(contextWindowSize * 0.02));
  } catch {
    return 16_000;
  }
}

async function buildSkillLoadResult(
  cwd: string,
  skills: Skill[],
  errors: SkillLoadResult['errors'],
): Promise<SkillLoadResult> {
  const budget = await resolveSkillCharacterBudget(cwd);
  const availableCandidates = skills.filter((skill) => skill.frontmatter.disable_model_invocation !== true);
  const availableSkills = applyCharacterBudget(cwd, availableCandidates, budget);

  return {
    skills,
    availableSkills,
    errors,
    characterBudgetUsed: buildAvailableSkillsText(availableSkills).length,
  };
}

function estimateContextWindowSize(model: string): number {
  const normalized = model.toLowerCase();
  const knownWindows: Array<[string, number]> = [
    ['claude', 200_000],
    ['gpt-4o', 128_000],
    ['gpt-4-turbo', 128_000],
    ['o1', 200_000],
    ['o3', 200_000],
    ['gemini-2.5', 1_000_000],
    ['gemini-2.0', 1_000_000],
    ['sonar', 128_000],
    ['deepseek', 128_000],
    ['grok', 128_000],
    ['command-r', 128_000],
    ['mixtral', 32_000],
    ['llama', 128_000],
    ['mistral-large', 128_000],
    ['mistral-small', 32_000],
    ['codestral', 256_000],
  ];

  for (const [pattern, size] of knownWindows) {
    if (normalized.includes(pattern)) {
      return size;
    }
  }

  return 200_000;
}

function applyCharacterBudget(cwd: string, skills: Skill[], budget: number): Skill[] {
  const prioritized = skills
    .map((skill, index) => ({
      skill,
      index,
      priority: getSkillPriority(skill, cwd),
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.index - right.index;
    });

  const kept = [...prioritized];
  let text = buildAvailableSkillsText(kept.map((entry) => entry.skill));

  while (kept.length > 0 && text.length > budget) {
    const dropped = kept.shift();
    if (dropped) {
      logger.warn(`Dropping skill "${dropped.skill.frontmatter.name}" from Skill tool list due to character budget.`);
    }
    text = buildAvailableSkillsText(kept.map((entry) => entry.skill));
  }

  return kept.map((entry) => entry.skill);
}

function getSkillPriority(skill: Skill, cwd: string): SkillPriority {
  const normalizedSource = resolve(skill.source);
  const projectSkillsPrefix = `${resolve(cwd, '.iris', 'skills')}${sep}`;
  const globalSkillsPrefix = `${resolve(process.env.HOME ?? homedir(), '.iris', 'skills')}${sep}`;
  const pluginMarker = `${sep}.iris${sep}plugins${sep}`;

  if (normalizedSource.includes(pluginMarker)) {
    return 2;
  }
  if (normalizedSource.startsWith(projectSkillsPrefix)) {
    return 1;
  }
  if (normalizedSource.startsWith(globalSkillsPrefix)) {
    return 0;
  }
  if (dirname(normalizedSource).includes(pluginMarker)) {
    return 2;
  }
  return 1;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
