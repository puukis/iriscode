import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import type { BuiltinHandler, CommandEntry, SessionDisplayMessage } from '../types.ts';

const MAX_TREE_ENTRIES = 160;
const MAX_FILE_PREVIEW_CHARS = 5000;
const MAX_EXISTING_CONTEXT_CHARS = 5000;
const MAX_CONVERSATION_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 1200;
const IMPORTANT_FILE_NAMES = [
  'package.json',
  'README.md',
  'tsconfig.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Dockerfile',
  'docker-compose.yml',
  '.env.example',
];
const SOURCE_SAMPLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.sh',
  '.css',
  '.scss',
  '.md',
]);
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\s*/;
const CONFIG_SECTION_RE = /^## Config\s*\n+```ya?ml\s*\n[\s\S]*?\n```\s*$/m;
const WHOLE_RESPONSE_CODE_FENCE_RE = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i;
const INIT_SYSTEM_PROMPT = [
  'You write project context files for IrisCode.',
  'Return only the markdown body for IRIS.md.',
  'Do not include YAML frontmatter.',
  'Do not include a ## Config section.',
  'Do not wrap the response in code fences.',
  'Write enough detail for a coding agent to understand the project, architecture, workflows, conventions, and current priorities.',
  'Prefer concrete facts from the provided repository snapshot and conversation context.',
  'Anchor the project description to the actual product surface shown in the repository metadata.',
  'Identify the primary product type first, such as CLI, coding assistant, TUI app, library, service, or framework.',
  'Do not describe the project as a framework, SDK, or reusable library unless the repository evidence explicitly supports that.',
  'If package metadata or docs describe the project as a CLI or coding assistant, use that framing consistently.',
].join(' ');

export const INIT_COMMAND: CommandEntry = {
  name: 'init',
  description: 'Analyze the repo and current conversation, then write IRIS.md.',
  category: 'builtin',
};

export const handleInit: BuiltinHandler = async (ctx) => {
  try {
    const irisPath = resolve(ctx.cwd, 'IRIS.md');
    const existingContent = existsSync(irisPath) ? readFileSync(irisPath, 'utf-8') : '';

    if (existingContent) {
      const answer = await ctx.session.ask(
        'IRIS.md already exists. Regenerate the project context and preserve existing config blocks? (y/n)',
      );
      if (!/^y(es)?$/i.test(answer.trim())) {
        ctx.session.writeInfo('Aborted. IRIS.md was left unchanged.');
        return { type: 'handled' };
      }
    }

    ctx.session.writeInfo('Analyzing the repository and recent conversation for /init...');

    const preserved = extractPreservedBlocks(existingContent);
    const prompt = buildInitPrompt({
      cwd: ctx.cwd,
      existingContext: stripStructuredBlocks(existingContent),
      projectSnapshot: inspectProject(ctx.cwd),
      recentConversation: formatRecentConversation(ctx.session.displayMessages),
    });

    const generated = await ctx.session.executePrompt({
      text: prompt,
      allowedTools: [],
      systemPrompt: INIT_SYSTEM_PROMPT,
    });

    const generatedBody = sanitizeGeneratedContent(generated);
    if (!generatedBody) {
      throw new Error('Model returned empty IRIS.md content.');
    }

    writeFileSync(
      irisPath,
      `${assembleIrisDocument(generatedBody, preserved).trim()}\n`,
      'utf-8',
    );
    await ctx.session.refreshContext();
    ctx.session.writeInfo(
      preserved.frontmatter || preserved.configSection
        ? 'IRIS.md updated. Existing config blocks were preserved.'
        : 'IRIS.md created from the current repo and conversation context.',
    );
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

function buildInitPrompt(input: {
  cwd: string;
  existingContext: string;
  projectSnapshot: string;
  recentConversation: string;
}): string {
  return [
    `Project root: ${input.cwd}`,
    '',
    'Write a strong IRIS.md context file for this project.',
    'The output should help future agent sessions understand the codebase quickly.',
    'Cover the project purpose, major subsystems, important workflows, conventions, constraints, and any current work implied by the conversation.',
    'Start by stating what the product primarily is in user-facing terms.',
    'Do not misclassify a CLI app or coding assistant as a framework unless the repo evidence clearly says that.',
    'Use headings when useful, and be as long as needed to capture the important details.',
    '',
    'Recent conversation',
    '-------------------',
    input.recentConversation,
    '',
    'Existing IRIS.md context to refresh',
    '-----------------------------------',
    input.existingContext || '(none)',
    '',
    'Repository snapshot',
    '-------------------',
    input.projectSnapshot,
  ].join('\n');
}

function inspectProject(cwd: string): string {
  const sections = [
    `cwd: ${cwd}`,
    '',
    'Project tree:',
    ...collectProjectTree(cwd),
  ];

  const importantFiles = collectImportantFiles(cwd);
  if (importantFiles.length > 0) {
    sections.push('', 'Important files:');
    for (const filePath of importantFiles) {
      const preview = readProjectFilePreview(cwd, filePath);
      if (!preview) {
        continue;
      }
      sections.push('', `File: ${relative(cwd, filePath)}`, '', preview);
    }
  }

  const sourceSamples = collectSourceSamples(cwd, importantFiles);
  if (sourceSamples.length > 0) {
    sections.push('', 'Representative source files:');
    for (const filePath of sourceSamples) {
      const preview = readProjectFilePreview(cwd, filePath);
      if (!preview) {
        continue;
      }
      sections.push('', `File: ${relative(cwd, filePath)}`, '', preview);
    }
  }

  return sections.join('\n');
}

function collectProjectTree(cwd: string): string[] {
  const lines: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (lines.length >= MAX_TREE_ENTRIES) {
      return;
    }

    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !shouldIgnoreEntry(entry.name))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    for (const entry of entries) {
      if (lines.length >= MAX_TREE_ENTRIES) {
        break;
      }

      const fullPath = resolve(dir, entry.name);
      const marker = entry.isDirectory() ? '[dir]' : '[file]';
      lines.push(`${'  '.repeat(depth)}${marker} ${entry.name}`);

      if (entry.isDirectory() && depth < 2) {
        walk(fullPath, depth + 1);
      }
    }
  };

  walk(resolve(cwd), 0);

  if (lines.length >= MAX_TREE_ENTRIES) {
    lines.push('... truncated ...');
  }

  return lines;
}

function collectImportantFiles(cwd: string): string[] {
  return IMPORTANT_FILE_NAMES
    .map((name) => resolve(cwd, name))
    .filter((filePath) => existsSync(filePath) && statSync(filePath).isFile());
}

function collectSourceSamples(cwd: string, alreadyIncluded: string[]): string[] {
  const included = new Set(alreadyIncluded.map((filePath) => resolve(filePath)));
  const samples: string[] = [];
  const preferredDirectories = ['src', 'app', 'lib', 'server', 'client', 'packages'];

  for (const directory of preferredDirectories) {
    const fullPath = resolve(cwd, directory);
    if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
      continue;
    }

    walkForSourceSamples(fullPath, samples, included, 5);
    if (samples.length >= 5) {
      break;
    }
  }

  if (samples.length >= 5) {
    return samples.slice(0, 5);
  }

  walkForSourceSamples(resolve(cwd), samples, included, 5);
  return samples.slice(0, 5);
}

function walkForSourceSamples(
  root: string,
  samples: string[],
  included: Set<string>,
  limit: number,
): void {
  if (samples.length >= limit) {
    return;
  }

  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => !shouldIgnoreEntry(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (samples.length >= limit) {
      return;
    }

    const fullPath = resolve(root, entry.name);
    if (included.has(fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      walkForSourceSamples(fullPath, samples, included, limit);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : '';
    if (!SOURCE_SAMPLE_EXTENSIONS.has(extension)) {
      continue;
    }

    samples.push(fullPath);
    included.add(fullPath);
  }
}

function readProjectFilePreview(cwd: string, filePath: string): string | null {
  try {
    if (!statSync(filePath).isFile()) {
      return null;
    }

    if (relative(cwd, filePath) === 'package.json') {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      return JSON.stringify(
        {
          name: typeof parsed.name === 'string' ? parsed.name : undefined,
          private: typeof parsed.private === 'boolean' ? parsed.private : undefined,
          type: typeof parsed.type === 'string' ? parsed.type : undefined,
          scripts: isRecord(parsed.scripts) ? parsed.scripts : undefined,
          dependencies: summarizeDependencyMap(parsed.dependencies),
          devDependencies: summarizeDependencyMap(parsed.devDependencies),
        },
        null,
        2,
      ).slice(0, MAX_FILE_PREVIEW_CHARS);
    }

    const content = readFileSync(filePath, 'utf-8');
    if (content.includes('\u0000')) {
      return null;
    }

    return content.slice(0, MAX_FILE_PREVIEW_CHARS);
  } catch {
    return null;
  }
}

function summarizeDependencyMap(value: unknown): string[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.keys(value).sort().slice(0, 30);
}

function formatRecentConversation(messages: SessionDisplayMessage[]): string {
  const relevant = messages
    .filter((message) => message.text.trim().length > 0)
    .slice(-MAX_CONVERSATION_MESSAGES);

  if (relevant.length === 0) {
    return '(no conversation yet)';
  }

  return relevant
    .map((message, index) => {
      const prefix = `${index + 1}. ${message.role}`;
      return `${prefix}: ${truncate(message.text.trim(), MAX_MESSAGE_CHARS)}`;
    })
    .join('\n\n');
}

function extractPreservedBlocks(content: string): {
  frontmatter: string;
  configSection: string;
} {
  const frontmatter = content.match(FRONTMATTER_RE)?.[0].trim() ?? '';
  const configSection = content.match(CONFIG_SECTION_RE)?.[0].trim() ?? '';
  return { frontmatter, configSection };
}

function stripStructuredBlocks(content: string): string {
  let working = content.replace(FRONTMATTER_RE, '').trim();
  const match = working.match(CONFIG_SECTION_RE);
  if (match && match.index !== undefined) {
    working = `${working.slice(0, match.index)}${working.slice(match.index + match[0].length)}`.trim();
  }
  return truncate(working, MAX_EXISTING_CONTEXT_CHARS);
}

function sanitizeGeneratedContent(content: string): string {
  let working = content.trim();

  const fenced = working.match(WHOLE_RESPONSE_CODE_FENCE_RE);
  if (fenced) {
    working = fenced[1].trim();
  }

  working = working.replace(FRONTMATTER_RE, '').trim();

  const configMatch = working.match(CONFIG_SECTION_RE);
  if (configMatch && configMatch.index !== undefined) {
    working = `${working.slice(0, configMatch.index)}${working.slice(configMatch.index + configMatch[0].length)}`.trim();
  }

  return working;
}

function assembleIrisDocument(
  generatedBody: string,
  preserved: { frontmatter: string; configSection: string },
): string {
  return [preserved.frontmatter, generatedBody.trim(), preserved.configSection]
    .filter((section) => section.trim().length > 0)
    .join('\n\n');
}

function shouldIgnoreEntry(name: string): boolean {
  return [
    '.git',
    '.iris',
    '.DS_Store',
    'node_modules',
    'dist',
    'build',
    '.next',
    'coverage',
    '.turbo',
  ].includes(name);
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
