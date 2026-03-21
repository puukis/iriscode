import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import type { CommandEntry } from '../types.ts';

export interface ParsedMarkdownCommand {
  frontmatter: Partial<Record<'description' | 'argument-hint' | 'model', unknown>> & {
    'allowed-tools'?: unknown;
  };
  body: string;
}

export async function readMarkdownCommandFile(path: string): Promise<ParsedMarkdownCommand> {
  const content = await readFile(path, 'utf-8');
  return parseMarkdownCommandContent(content);
}

export function parseMarkdownCommandContent(content: string): ParsedMarkdownCommand {
  if (!content.startsWith('---\n')) {
    return {
      frontmatter: {},
      body: content,
    };
  }

  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return {
      frontmatter: {},
      body: content,
    };
  }

  const rawYaml = content.slice(4, endIndex);
  const body = content.slice(endIndex + '\n---\n'.length);
  const parsed = parseYaml(rawYaml);

  return {
    frontmatter: typeof parsed === 'object' && parsed !== null
      ? parsed as ParsedMarkdownCommand['frontmatter']
      : {},
    body,
  };
}

export function normalizeAllowedTools(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}

export function createCommandEntryFromFile(
  name: string,
  path: string,
  category: CommandEntry['category'],
  parsed: ParsedMarkdownCommand,
  fallbackDescription: string,
): CommandEntry {
  const description =
    typeof parsed.frontmatter.description === 'string' && parsed.frontmatter.description.trim()
      ? parsed.frontmatter.description.trim()
      : fallbackDescription;

  const argumentHint =
    typeof parsed.frontmatter['argument-hint'] === 'string' && parsed.frontmatter['argument-hint'].trim()
      ? parsed.frontmatter['argument-hint'].trim()
      : undefined;

  const model =
    typeof parsed.frontmatter.model === 'string' && parsed.frontmatter.model.trim()
      ? parsed.frontmatter.model.trim()
      : undefined;

  return {
    name,
    description,
    category,
    argumentHint,
    source: path,
    allowedTools: normalizeAllowedTools(parsed.frontmatter['allowed-tools']),
    model,
  };
}

export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) {
    return content;
  }
  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return content;
  }
  return content.slice(endIndex + '\n---\n'.length);
}
