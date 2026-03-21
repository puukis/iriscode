import type { Tool, ToolExecutionContext } from '../index.ts';
import type { Message, ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { parseModelString } from '../../models/registry.ts';
import { fail, ok, toJson } from '../result.ts';

const USER_AGENT = 'iriscode/0.1.0';
const MAX_URL_LENGTH = 2048;
const MAX_FETCH_BYTES = 10 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 100 * 1024;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_REDIRECTS = 5;

interface CachedPage {
  kind: 'page';
  url: string;
  fetchedAt: string;
  truncated: boolean;
  markdown: string;
  expiresAt: number;
}

interface CachedRedirect {
  kind: 'redirect';
  url: string;
  fetchedAt: string;
  truncated: false;
  redirectedTo: string;
  expiresAt: number;
}

type CacheEntry = CachedPage | CachedRedirect;

const pageCache = new Map<string, CacheEntry>();

export class WebFetchTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'web-fetch',
    description: 'Fetch a URL and answer a specific question about the page content.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        question: { type: 'string', description: 'Question to answer about the page' },
      },
      required: ['url', 'question'],
    },
  };

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const rawUrl = typeof input['url'] === 'string' ? input['url'].trim() : '';
    const question = typeof input['question'] === 'string' ? input['question'].trim() : '';

    if (!rawUrl) return fail('web-fetch', 'url must be a non-empty string');
    if (!question) return fail('web-fetch', 'question must be a non-empty string');

    const normalizedUrl = normalizeFetchUrl(rawUrl);
    if ('error' in normalizedUrl) return normalizedUrl.error;

    if (!urlExistsInHistory(context.history, normalizedUrl.value, rawUrl)) {
      return fail(
        'web-fetch',
        'URL denied: it has not appeared in this session history. Use web-search first or provide the URL in the conversation before fetching it.',
      );
    }

    const cacheEntry = await getOrFetchPage(normalizedUrl.value);
    if ('error' in cacheEntry) return cacheEntry.error;

    if (cacheEntry.value.kind === 'redirect') {
      return ok(
        toJson({
          answer: 'Fetch stopped because the URL redirected to a different host.',
          url: cacheEntry.value.url,
          fetchedAt: cacheEntry.value.fetchedAt,
          truncated: cacheEntry.value.truncated,
          redirectedTo: cacheEntry.value.redirectedTo,
        }),
      );
    }

    const modelKey = selectFastModel(context);
    let adapter: ToolExecutionContext['adapter'];
    try {
      adapter = context.modelRegistry.get(modelKey);
    } catch (err) {
      return fail(
        'web-fetch',
        `Unable to resolve a model for page analysis: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const llmResult = await answerQuestionWithModel(
      adapter,
      cacheEntry.value.url,
      cacheEntry.value.markdown,
      question,
    );
    if ('error' in llmResult) return llmResult.error;

    const { provider, modelId } = parseModelString(modelKey);
    if (llmResult.usage && context.costTracker) {
      context.costTracker.add(provider, modelId, llmResult.usage.inputTokens, llmResult.usage.outputTokens);
    }

    return ok(
      toJson({
        answer: capLongQuotes(llmResult.answer.trim()),
        url: cacheEntry.value.url,
        fetchedAt: cacheEntry.value.fetchedAt,
        truncated: cacheEntry.value.truncated,
      }),
    );
  }
}

async function getOrFetchPage(url: string): Promise<{ value: CacheEntry } | { error: ToolResult }> {
  const now = Date.now();
  const cached = pageCache.get(url);
  if (cached && cached.expiresAt > now) {
    return { value: cached };
  }
  if (cached) {
    pageCache.delete(url);
  }

  const fetched = await fetchPage(url);
  if ('error' in fetched) return fetched;

  pageCache.set(url, fetched.value);
  return fetched;
}

async function fetchPage(url: string): Promise<{ value: CacheEntry } | { error: ToolResult }> {
  let currentUrl = url;
  let redirects = 0;

  while (redirects <= MAX_REDIRECTS) {
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html, text/plain, application/xhtml+xml, application/json;q=0.8, */*;q=0.5',
        },
      });
    } catch (err) {
      return {
        error: fail(
          'web-fetch',
          `Failed to fetch "${currentUrl}": ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        return {
          error: fail('web-fetch', `Redirect response from "${currentUrl}" was missing a location header`),
        };
      }

      const nextUrl = resolveRedirectUrl(currentUrl, location);
      if ('error' in nextUrl) return nextUrl;

      const currentHost = new URL(currentUrl).host;
      const nextHost = new URL(nextUrl.value).host;
      if (currentHost !== nextHost) {
        return {
          value: {
            kind: 'redirect',
            url: currentUrl,
            fetchedAt: new Date().toISOString(),
            truncated: false,
            redirectedTo: nextUrl.value,
            expiresAt: Date.now() + CACHE_TTL_MS,
          },
        };
      }

      currentUrl = nextUrl.value;
      redirects += 1;
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        error: fail(
          'web-fetch',
          `Fetch failed for "${currentUrl}" with status ${response.status}: ${body || response.statusText}`,
        ),
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!isTextLikeContentType(contentType)) {
      return {
        error: fail('web-fetch', `URL returned unsupported content type "${contentType || 'unknown'}"`),
      };
    }

    const body = await readResponseBody(response);
    if ('error' in body) return body;

    const processed = processFetchedContent(contentType, body.value);

    return {
      value: {
        kind: 'page',
        url: currentUrl,
        fetchedAt: new Date().toISOString(),
        truncated: processed.truncated,
        markdown: processed.markdown,
        expiresAt: Date.now() + CACHE_TTL_MS,
      },
    };
  }

  return {
    error: fail('web-fetch', `Too many redirects while fetching "${url}"`),
  };
}

function normalizeFetchUrl(rawUrl: string): { value: string } | { error: ToolResult } {
  if (rawUrl.length > MAX_URL_LENGTH) {
    return { error: fail('web-fetch', `url exceeds the maximum length of ${MAX_URL_LENGTH} characters`) };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: fail('web-fetch', 'url must be a valid absolute URL') };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: fail('web-fetch', 'url must use http:// or https://') };
  }

  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }

  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';

  return { value: parsed.toString() };
}

function resolveRedirectUrl(baseUrl: string, location: string): { value: string } | { error: ToolResult } {
  try {
    const resolved = new URL(location, baseUrl);
    if (resolved.protocol === 'http:') {
      resolved.protocol = 'https:';
    }
    resolved.username = '';
    resolved.password = '';
    resolved.hash = '';
    return { value: resolved.toString() };
  } catch {
    return { error: fail('web-fetch', `Invalid redirect target "${location}"`) };
  }
}

function urlExistsInHistory(history: Message[], normalizedUrl: string, rawUrl: string): boolean {
  const seenUrls = new Set<string>();
  const searchableHistory = history.filter((message, index) => {
    if (index !== history.length - 1 || message.role !== 'assistant' || typeof message.content === 'string') {
      return true;
    }
    return !message.content.some((block) => block.type === 'tool_use');
  });

  for (const message of searchableHistory) {
    for (const text of messageToSearchableStrings(message)) {
      for (const match of text.matchAll(/https?:\/\/[^\s)<>"']+/g)) {
        const normalizedMatch = normalizeFetchUrl(match[0]);
        if ('value' in normalizedMatch) {
          seenUrls.add(normalizedMatch.value);
        }
      }
    }
  }

  const rawNormalized = normalizeFetchUrl(rawUrl);
  if ('value' in rawNormalized && seenUrls.has(rawNormalized.value)) {
    return true;
  }

  return seenUrls.has(normalizedUrl);
}

function messageToSearchableStrings(message: Message): string[] {
  if (typeof message.content === 'string') {
    return [message.content];
  }

  const strings: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      strings.push(block.text);
    } else if (block.type === 'tool_result') {
      strings.push(block.content);
    }
  }
  return strings;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isTextLikeContentType(contentType: string): boolean {
  return (
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('javascript')
  );
}

async function readResponseBody(response: Response): Promise<{ value: string } | { error: ToolResult }> {
  if (!response.body) return { value: '' };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_FETCH_BYTES) {
        return {
          error: fail('web-fetch', `Response exceeded the ${MAX_FETCH_BYTES} byte limit`),
        };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { value: new TextDecoder().decode(bytes) };
}

function processFetchedContent(contentType: string, body: string): { markdown: string; truncated: boolean } {
  const rawContent = contentType.includes('html') ? htmlToMarkdown(body) : body;
  return truncateToBytes(rawContent.trim(), MAX_MARKDOWN_BYTES);
}

function htmlToMarkdown(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_match, tag, content) => {
        const level = Number(tag.slice(1));
        return `\n\n${'#'.repeat(level)} ${stripTags(content).trim()}\n\n`;
      })
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, content) => `\n\n\`\`\`\n${stripTags(content).trim()}\n\`\`\`\n\n`)
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_match, content) => `\`${stripTags(content).trim()}\``)
      .replace(/<a [^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, content) => {
        const text = stripTags(content).trim();
        return text ? `[${text}](${href})` : href;
      })
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, content) => `\n- ${stripTags(content).trim()}`)
      .replace(/<(p|div|section|article|main|aside|header|footer|blockquote|table|tr)[^>]*>/gi, '\n\n')
      .replace(/<\/(p|div|section|article|main|aside|header|footer|blockquote|table|tr)>/gi, '\n\n')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' '),
  ).trim();
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function truncateToBytes(text: string, maxBytes: number): { markdown: string; truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) {
    return { markdown: text, truncated: false };
  }

  let end = text.length;
  while (end > 0 && encoder.encode(text.slice(0, end)).byteLength > maxBytes) {
    end -= 1;
  }

  return {
    markdown: `${text.slice(0, end).trimEnd()}\n\n[Content truncated]`,
    truncated: true,
  };
}

function selectFastModel(context: ToolExecutionContext): string {
  const preferred = context.modelRegistry.keys().find((key) =>
    /^anthropic\/claude-haiku-4-5(?:[-\w.]*)?$/.test(key),
  );

  if (preferred) return preferred;
  if (context.modelRegistry.has(context.model)) return context.model;
  return `${context.adapter.provider}/${context.adapter.modelId}`;
}

async function answerQuestionWithModel(
  adapter: ToolExecutionContext['adapter'],
  url: string,
  markdown: string,
  question: string,
): Promise<
  | { answer: string; usage: { inputTokens: number; outputTokens: number } }
  | { error: ToolResult }
> {
  const prompt = [
    `URL: ${url}`,
    `Question: ${question}`,
    'Answer the question using only the page content below.',
    'If the page does not contain the answer, say so plainly.',
    'Do not include direct quotes longer than 125 characters.',
    '',
    markdown,
  ].join('\n');

  let answer = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for await (const event of adapter.stream({
      messages: [{ role: 'user', content: prompt }],
      tools: [],
      systemPrompt: '',
      maxTokens: 1024,
    })) {
      if (event.type === 'text') {
        answer += event.text ?? '';
      } else if (event.type === 'done') {
        inputTokens = event.inputTokens ?? 0;
        outputTokens = event.outputTokens ?? 0;
      }
    }
  } catch (err) {
    return {
      error: fail(
        'web-fetch',
        `Model pass failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }

  return { answer, usage: { inputTokens, outputTokens } };
}

function capLongQuotes(answer: string): string {
  return answer
    .replace(/"([^"\n]{126,})"/g, (_match, quote: string) => `"${quote.slice(0, 125)}..."`)
    .replace(/'([^'\n]{126,})'/g, (_match, quote: string) => `'${quote.slice(0, 125)}...'`)
    .split('\n')
    .map((line) => {
      if (!line.startsWith('> ')) return line;
      return line.length > 127 ? `${line.slice(0, 127)}...` : line;
    })
    .join('\n');
}
