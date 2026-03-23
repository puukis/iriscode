import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Skill } from '../../skills/types.ts';
import { loadSkills } from '../../skills/loader.ts';
import { loadSkillIntoSession, registerSkillCommands } from '../skill-bridge.ts';
import type { BuiltinHandler, CommandEntry, PickerOption } from '../types.ts';

export const SKILLS_COMMAND: CommandEntry = {
  name: 'skills',
  description: 'Browse, run, inspect, and create skills.',
  category: 'builtin',
};

export const handleSkills: BuiltinHandler = async (ctx) => {
  try {
    if (!ctx.skillResult) {
      ctx.session.writeInfo('Skills are unavailable in this session.');
      return { type: 'handled' };
    }

    ctx.session.writeInfo(renderSkillTable(ctx.skillResult.skills, ctx.cwd));
    const action = await ctx.session.openPicker([
      { label: 'Run skill', value: 'run', description: 'Load a skill and optionally continue with a prompt' },
      { label: 'Create skill', value: 'create', description: 'Create a new project skill from a template' },
      { label: 'Show skill details', value: 'details', description: 'View the full SKILL.md file' },
    ], 'Skills');

    if (!action) {
      return { type: 'handled' };
    }

    if (action === 'run') {
      return runSkill(ctx);
    }
    if (action === 'create') {
      await createSkill(ctx);
      return { type: 'handled' };
    }
    if (action === 'details') {
      await showSkillDetails(ctx);
      return { type: 'handled' };
    }

    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

async function runSkill(ctx: Parameters<BuiltinHandler>[0]) {
  const selected = await pickSkill(ctx, 'Run skill');
  if (!selected || !ctx.skillResult) {
    ctx.session.writeInfo('Run skill cancelled.');
    return { type: 'handled' } as const;
  }

  const loaded = loadSkillIntoSession(selected, ctx);
  if ('error' in loaded) {
    return { type: 'error', message: loaded.error } as const;
  }

  const prompt = (await ctx.session.ask('Optional prompt after loading the skill:')).trim();
  if (!prompt) {
    ctx.session.writeInfo(`Loaded skill: ${selected}`);
    return { type: 'handled' } as const;
  }

  return { type: 'prompt', text: prompt } as const;
}

async function createSkill(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  const rawName = (await ctx.session.ask('Skill name (kebab-case):')).trim();
  if (!rawName) {
    ctx.session.writeInfo('Skill creation cancelled.');
    return;
  }

  const folderName = rawName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!folderName) {
    ctx.session.writeInfo('Skill creation cancelled.');
    return;
  }

  const skillDir = resolve(ctx.cwd, '.iris', 'skills', folderName);
  const skillPath = resolve(skillDir, 'SKILL.md');
  mkdirSync(skillDir, { recursive: true });
  if (!existsSync(skillPath)) {
    writeFileSync(skillPath, buildSkillTemplate(folderName), 'utf-8');
  }

  await openInTerminalEditor(skillPath);
  ctx.session.resumeUi();
  if (ctx.skillResult) {
    Object.assign(ctx.skillResult, await loadSkills(ctx.cwd));
    if (ctx.registry) {
      registerSkillCommands(ctx.registry, ctx.skillResult);
    }
  }
  ctx.session.writeInfo(`Created skill template at ${skillPath}`);
}

async function showSkillDetails(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  const selected = await pickSkill(ctx, 'Show skill details');
  if (!selected || !ctx.skillResult) {
    ctx.session.writeInfo('Show skill details cancelled.');
    return;
  }

  const skill = ctx.skillResult.skills.find((entry) => entry.frontmatter.name === selected);
  if (!skill) {
    ctx.session.writeInfo(`Skill "${selected}" is no longer available.`);
    return;
  }

  ctx.session.writeInfo(readFileSync(skill.source, 'utf-8'));
}

async function pickSkill(
  ctx: Parameters<BuiltinHandler>[0],
  title: string,
): Promise<string | undefined> {
  const options: PickerOption[] = (ctx.skillResult?.skills ?? []).map((skill) => ({
    label: skill.frontmatter.name,
    value: skill.frontmatter.name,
    description: skill.frontmatter.description,
  }));

  return ctx.session.openPicker(options, title);
}

function renderSkillTable(
  skills: Skill[],
  cwd: string,
): string {
  if (skills.length === 0) {
    return 'No skills loaded.';
  }

  const rows = skills.map((skill) => ({
    name: skill.frontmatter.name,
    description: skill.frontmatter.description,
    tags: skill.frontmatter.tags?.join(', ') || '-',
    source: classifySkillSource(skill.source, cwd),
    model: skill.frontmatter.model ?? '-',
    allowedTools: skill.frontmatter.allowed_tools ?? '-',
  }));

  const widths = {
    name: Math.max(4, ...rows.map((row) => row.name.length)),
    source: Math.max(6, ...rows.map((row) => row.source.length)),
    model: Math.max(5, ...rows.map((row) => row.model.length)),
  };

  return [
    `${'name'.padEnd(widths.name)}  ${'source'.padEnd(widths.source)}  ${'model'.padEnd(widths.model)}  tags  description  allowed tools`,
    ...rows.map((row) =>
      `${row.name.padEnd(widths.name)}  ${row.source.padEnd(widths.source)}  ${row.model.padEnd(widths.model)}  ${row.tags}  ${row.description}  ${row.allowedTools}`,
    ),
  ].join('\n');
}

function classifySkillSource(source: string, cwd: string): string {
  const normalized = resolve(source);
  if (normalized.includes(`${resolve(cwd, '.iris', 'plugins')}/`) || normalized.includes(`${resolve(process.env.HOME ?? '', '.iris', 'plugins')}/`)) {
    return 'plugin';
  }
  if (normalized.startsWith(resolve(cwd, '.iris', 'skills'))) {
    return 'project';
  }
  return 'global';
}

function buildSkillTemplate(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: Describe when this skill should be used',
    'tags:',
    '  - workflow',
    'allowed_tools: Read, Glob, Grep',
    '---',
    '',
    'Describe what the skill should do and how it should guide the model.',
    '',
    'If this skill needs helper scripts, place them under `scripts/` relative to this folder.',
  ].join('\n');
}

async function openInTerminalEditor(filePath: string): Promise<void> {
  const editor = resolveTerminalEditor();
  const stdin = process.stdin as NodeJS.ReadStream & {
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  const wasRaw = Boolean(stdin.isRaw);
  const interactiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (interactiveTty && wasRaw) {
    stdin.setRawMode?.(false);
  }
  if (interactiveTty) {
    process.stdout.write('\x1b[?2004l');
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  }

  try {
    const result = Bun.spawnSync([...editor, filePath], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (result.exitCode !== 0) {
      throw new Error(`Editor exited with code ${result.exitCode}`);
    }
  } finally {
    if (interactiveTty) {
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      process.stdout.write('\x1b[?2004h');
    }
    if (interactiveTty && wasRaw) {
      stdin.setRawMode?.(true);
    }
  }
}

function resolveTerminalEditor(): string[] {
  const candidates = [process.env.EDITOR?.trim(), 'vim', 'nano']
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  for (const candidate of candidates) {
    const [command, ...args] = candidate.split(/\s+/).filter(Boolean);
    if (command && Bun.which(command)) {
      return [command, ...args];
    }
  }

  throw new Error('No terminal editor found. Install vim or nano, or set $EDITOR.');
}
