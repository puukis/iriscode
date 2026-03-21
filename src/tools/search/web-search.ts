import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DUCKDUCKGO_ENDPOINT = 'https://api.duckduckgo.com/';
const USER_AGENT = 'iriscode/0.1.0';
const MAX_RESULTS = 8;

interface SearchResult {
  title: string;
  url: string;
}

export class WebSearchTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'web-search',
    description: 'Search the web and return page titles with URLs only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (minimum 2 characters)' },
        allowed_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional domain allowlist',
        },
        blocked_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional domain blocklist',
        },
      },
      required: ['query'],
    },
  };

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const query = typeof input['query'] === 'string' ? input['query'].trim() : '';
    if (query.length < 2) {
      return fail('web-search', 'query must be a string with at least 2 characters');
    }

    const allowedDomains = parseDomainList(input['allowed_domains'], 'allowed_domains');
    if ('error' in allowedDomains) return allowedDomains.error;

    const blockedDomains = parseDomainList(input['blocked_domains'], 'blocked_domains');
    if ('error' in blockedDomains) return blockedDomains.error;

    const effectiveQuery = buildSearchQuery(query, allowedDomains.value, blockedDomains.value);

    let results: SearchResult[];
    try {
      results = process.env.BRAVE_API_KEY
        ? await searchBrave(effectiveQuery)
        : await searchDuckDuckGo(effectiveQuery);
    } catch (err) {
      return fail(
        'web-search',
        `Search request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const filtered = dedupeResults(
      results.filter((result) =>
        shouldIncludeUrl(result.url, allowedDomains.value, blockedDomains.value),
      ),
    ).slice(0, MAX_RESULTS);

    if (filtered.length === 0) {
      return ok('No results found.');
    }

    const content = filtered
      .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}`)
      .join('\n\n');

    return ok(content);
  }
}

async function searchBrave(query: string): Promise<SearchResult[]> {
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', '12');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      'X-Subscription-Token': process.env.BRAVE_API_KEY!,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Brave API error ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json() as {
    web?: { results?: Array<{ title?: string; url?: string }> };
  };

  return (data.web?.results ?? [])
    .map((result) => ({
      title: sanitizeTitle(result.title),
      url: sanitizeUrl(result.url),
    }))
    .filter((result) => Boolean(result.title && result.url));
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = new URL(DUCKDUCKGO_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`DuckDuckGo API error ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json() as {
    Results?: Array<{ Text?: string; FirstURL?: string }>;
    RelatedTopics?: Array<Record<string, unknown>>;
  };

  const results: SearchResult[] = [];
  for (const item of data.Results ?? []) {
    const result = normalizeDuckDuckGoItem(item);
    if (result) results.push(result);
  }

  for (const item of data.RelatedTopics ?? []) {
    collectDuckDuckGoTopics(item, results);
  }

  return results;
}

function collectDuckDuckGoTopics(item: Record<string, unknown>, results: SearchResult[]): void {
  if (Array.isArray(item['Topics'])) {
    for (const nested of item['Topics']) {
      if (nested && typeof nested === 'object') {
        collectDuckDuckGoTopics(nested as Record<string, unknown>, results);
      }
    }
    return;
  }

  const result = normalizeDuckDuckGoItem(item);
  if (result) results.push(result);
}

function normalizeDuckDuckGoItem(item: Record<string, unknown>): SearchResult | null {
  const title = sanitizeTitle(typeof item['Text'] === 'string' ? item['Text'] : '');
  const url = sanitizeUrl(typeof item['FirstURL'] === 'string' ? item['FirstURL'] : '');
  if (!title || !url) return null;
  return { title, url };
}

function parseDomainList(
  value: unknown,
  field: 'allowed_domains' | 'blocked_domains',
): { value: string[] } | { error: ToolResult } {
  if (value === undefined) return { value: [] };
  if (!Array.isArray(value)) {
    return { error: fail('web-search', `${field} must be an array of strings`) };
  }

  const domains: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      return { error: fail('web-search', `${field} must contain non-empty strings only`) };
    }
    domains.push(normalizeDomain(entry));
  }

  return { value: domains };
}

function buildSearchQuery(query: string, allowedDomains: string[], blockedDomains: string[]): string {
  const parts = [query];
  for (const domain of allowedDomains) {
    parts.push(`site:${domain}`);
  }
  for (const domain of blockedDomains) {
    parts.push(`-site:${domain}`);
  }
  return parts.join(' ');
}

function shouldIncludeUrl(url: string, allowedDomains: string[], blockedDomains: string[]): boolean {
  const host = extractHost(url);
  if (!host) return false;

  if (blockedDomains.some((domain) => matchesDomain(host, domain))) {
    return false;
  }

  if (allowedDomains.length > 0) {
    return allowedDomains.some((domain) => matchesDomain(host, domain));
  }

  return true;
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    deduped.push(result);
  }

  return deduped;
}

function sanitizeTitle(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function sanitizeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).toString();
  } catch {
    return '';
  }
}

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
