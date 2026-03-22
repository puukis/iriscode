import { loadGlobalConfig } from '../config/global.ts';
import { loadProjectConfig } from '../config/project.ts';

export interface IrisSource {
  path: string;
  lines: number;
  tokens: number;
}

export interface IrisHierarchyResult {
  contextText: string;
  sources: IrisSource[];
  totalTokens: number;
  totalLines: number;
}

/**
 * Estimates tokens using 4 chars per token approximation.
 * Spec-mandated: do not import a full tokenizer library.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Loads the full IRIS.md hierarchy in order (global → project → subdirs → rules).
 * Config YAML blocks are already stripped by the config loaders (parseProjectMarkdownFile).
 * Uses Promise.all for parallel reads — target: <100ms with 10 files.
 */
export async function loadIrisHierarchy(cwd: string): Promise<IrisHierarchyResult> {
  const [globalResult, projectResult] = await Promise.all([
    loadGlobalConfig(),
    loadProjectConfig(cwd),
  ]);

  // Global files first (least specific), then project files (most specific)
  const allFiles = [...globalResult.contextFiles, ...projectResult.contextFiles];

  if (allFiles.length === 0) {
    return { contextText: '', sources: [], totalTokens: 0, totalLines: 0 };
  }

  const sources: IrisSource[] = allFiles.map((file) => ({
    path: file.path,
    lines: file.lineCount,
    tokens: estimateTokens(file.text),
  }));

  const contextText = allFiles
    .map((file) => file.text.trim())
    .filter(Boolean)
    .join('\n---\n');

  const totalTokens = sources.reduce((sum, source) => sum + source.tokens, 0);
  const totalLines = sources.reduce((sum, source) => sum + source.lines, 0);

  return { contextText, sources, totalTokens, totalLines };
}
