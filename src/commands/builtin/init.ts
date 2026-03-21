import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const INIT_COMMAND: CommandEntry = {
  name: 'init',
  description: 'Generate an IRIS.md file for the current project.',
  category: 'builtin',
};

export const handleInit: BuiltinHandler = async (ctx) => {
  try {
    const irisPath = resolve(ctx.cwd, 'IRIS.md');
    if (existsSync(irisPath)) {
      const answer = await ctx.session.ask('IRIS.md already exists. Overwrite? (y/n)');
      if (!/^y(es)?$/i.test(answer.trim())) {
        ctx.session.writeInfo('Aborted. IRIS.md was left unchanged.');
        return { type: 'handled' };
      }
    }

    const projectSnapshot = inspectProject(ctx.cwd);
    const prompt = [
      'Generate a high-quality IRIS.md for this project.',
      'Return only the final markdown file content.',
      '',
      projectSnapshot,
    ].join('\n');

    const generated = await ctx.session.executePrompt({ text: prompt });
    writeFileSync(irisPath, `${generated.trim()}\n`, 'utf-8');
    await ctx.session.refreshContext();
    ctx.session.writeInfo('IRIS.md generated. Review it and commit it to git.');
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

function inspectProject(cwd: string): string {
  const topLevelEntries = readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.git'))
    .slice(0, 30)
    .map((entry) => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`);

  const sections = [
    `cwd: ${cwd}`,
    '',
    'Top-level structure:',
    ...topLevelEntries,
  ];

  for (const fileName of ['package.json', 'README.md', 'tsconfig.json', '.env.example']) {
    const path = join(cwd, fileName);
    if (!existsSync(path)) {
      continue;
    }
    sections.push('', `File: ${fileName}`, '', readFileSync(path, 'utf-8').slice(0, 4000));
  }

  return sections.join('\n');
}
