import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { ModelRegistry } from '../../../models/registry.ts';
import { FakeAdapter, cleanupDir, expectError, expectOk, makeToolContext, makeTempDir, writeFile, withEnv, withMockFetch } from '../../../shared/test-helpers.ts';
import { GlobTool } from '../glob.ts';
import { GrepTool } from '../grep.ts';
import { WebFetchTool } from '../web-fetch.ts';
import { WebSearchTool } from '../web-search.ts';

describe('search tools', () => {
  test('glob and grep find files and contents', async () => {
    const cwd = makeTempDir('iriscode-search-tools-');
    writeFile(join(cwd, 'a.txt'), 'hello world\nfind me\n');
    writeFile(join(cwd, 'b.txt'), 'another file\n');
    const context = makeToolContext({ cwd });

    const globResult = await new GlobTool().execute({ pattern: '*.txt', cwd }, context);
    expectOk(globResult);
    expect(globResult.content).toContain('a.txt');

    const grepResult = await new GrepTool().execute({ pattern: 'find', path: `${cwd}/*.txt` }, context);
    expectOk(grepResult);
    expect(grepResult.content).toContain('find me');

    cleanupDir(cwd);
  });

  test('web-search uses Brave when configured and DuckDuckGo otherwise', async () => {
    const tool = new WebSearchTool();
    const context = makeToolContext();

    await withEnv({ BRAVE_API_KEY: 'test-brave' }, async () => {
      await withMockFetch(
        (async (input) => {
          const url = String(input);
          expect(url).toContain('api.search.brave.com');
          return Response.json({
            web: {
              results: [
                { title: 'Alpha', url: 'https://example.com/a' },
                { title: 'Beta', url: 'https://example.com/b' },
              ],
            },
          });
        }) as typeof fetch,
        async () => {
          const result = await tool.execute({ query: 'alpha', allowed_domains: ['example.com'] }, context);
          expectOk(result);
          expect(result.content).toContain('1. Alpha');
        },
      );
    });

    await withEnv({ BRAVE_API_KEY: undefined }, async () => {
      await withMockFetch(
        (async (input) => {
          const url = String(input);
          expect(url).toContain('api.duckduckgo.com');
          return Response.json({
            Results: [{ Text: 'Duck Result', FirstURL: 'https://duck.example/result' }],
            RelatedTopics: [],
          });
        }) as typeof fetch,
        async () => {
          const result = await tool.execute({ query: 'duck' }, context);
          expectOk(result);
          expect(result.content).toContain('Duck Result');
        },
      );
    });
  });

  test('web-fetch enforces URL history gate and returns answered content', async () => {
    const tool = new WebFetchTool();
    const fastAdapter = new FakeAdapter('anthropic', 'claude-haiku-4-5-20251001', async function* () {
      yield { type: 'text', text: 'The page says IrisCode is a coding agent.' };
      yield { type: 'done', stopReason: 'end_turn', inputTokens: 12, outputTokens: 7 };
    });
    const modelRegistry = new ModelRegistry();
    modelRegistry.register('anthropic/claude-haiku-4-5-20251001', fastAdapter);

    const denied = await tool.execute(
      { url: 'https://example.com/page', question: 'What is this?' },
      makeToolContext({ adapter: fastAdapter, modelRegistry }),
    );
    expectError(denied);
    expect(denied.content).toContain('Use web-search first');

    await withMockFetch(
      (async (input) => {
        const url = String(input);
        if (url === 'https://example.com/page') {
          return new Response('<html><body><h1>IrisCode</h1><p>IrisCode is a coding agent.</p></body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        if (url === 'https://redirect.example/start') {
          return new Response('', {
            status: 302,
            headers: { location: 'https://other.example/landing' },
          });
        }
        throw new Error(`Unexpected fetch URL ${url}`);
      }) as typeof fetch,
      async () => {
        const allowedContext = makeToolContext({
          history: [{ role: 'user', content: 'Please inspect https://example.com/page' }],
          adapter: fastAdapter,
          modelRegistry,
        });
        const success = await tool.execute(
          { url: 'http://example.com/page', question: 'What does the page say?' },
          allowedContext,
        );
        expectOk(success);
        const parsed = JSON.parse(success.content) as { answer: string; truncated: boolean; url: string };
        expect(parsed.answer).toContain('coding agent');
        expect(parsed.url).toBe('https://example.com/page');
        expect(parsed.truncated).toBe(false);

        const redirectContext = makeToolContext({
          history: [{ role: 'user', content: 'Check https://redirect.example/start' }],
          adapter: fastAdapter,
          modelRegistry,
        });
        const redirect = await tool.execute(
          { url: 'https://redirect.example/start', question: 'What happened?' },
          redirectContext,
        );
        expectOk(redirect);
        const redirectParsed = JSON.parse(redirect.content) as { redirectedTo: string };
        expect(redirectParsed.redirectedTo).toBe('https://other.example/landing');
      },
    );
  });
});
