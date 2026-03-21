import { z } from 'zod';
import type { PermissionMode } from '../permissions/types.ts';

export const PROVIDER_NAMES = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'deepseek',
  'xai',
  'perplexity',
  'together',
  'fireworks',
  'cohere',
  'openrouter',
  'ollama',
] as const;

export type ProviderName = typeof PROVIDER_NAMES[number];

const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'plan']);

export const defaults = {
  default_model: 'anthropic/claude-sonnet-4-6',
  model: 'anthropic/claude-sonnet-4-6',
  log_level: 'warn',
  permissions: {
    mode: 'default' as PermissionMode,
    allowed_tools: [] as string[],
    disallowed_tools: [] as string[],
  },
  memory: {
    max_tokens: 10000,
    max_lines: 200,
    warn_at: 8000,
  },
  mcp_servers: [] as Array<{
    url: string;
    name: string;
    enabled: boolean;
  }>,
  providers: {
    anthropic: { apiKey: null, baseUrl: null },
    openai: { apiKey: null, baseUrl: null },
    google: { apiKey: null, baseUrl: null },
    groq: { apiKey: null, baseUrl: null },
    mistral: { apiKey: null, baseUrl: null },
    deepseek: { apiKey: null, baseUrl: null },
    xai: { apiKey: null, baseUrl: null },
    perplexity: { apiKey: null, baseUrl: null },
    together: { apiKey: null, baseUrl: null },
    fireworks: { apiKey: null, baseUrl: null },
    cohere: { apiKey: null, baseUrl: null },
    openrouter: { apiKey: null, baseUrl: null },
    ollama: { apiKey: null, baseUrl: 'http://localhost:11434' },
  },
  context_text: '',
} as const;

export const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
}).strict();

export const ProvidersSchema = z.object({
  anthropic: ProviderConfigSchema.optional(),
  openai: ProviderConfigSchema.optional(),
  google: ProviderConfigSchema.optional(),
  groq: ProviderConfigSchema.optional(),
  mistral: ProviderConfigSchema.optional(),
  deepseek: ProviderConfigSchema.optional(),
  xai: ProviderConfigSchema.optional(),
  perplexity: ProviderConfigSchema.optional(),
  together: ProviderConfigSchema.optional(),
  fireworks: ProviderConfigSchema.optional(),
  cohere: ProviderConfigSchema.optional(),
  openrouter: ProviderConfigSchema.optional(),
  ollama: ProviderConfigSchema.optional(),
}).strict();

export const PermissionsSchema = z.object({
  mode: PermissionModeSchema.optional(),
  allowed_tools: z.array(z.string().min(1)).optional(),
  disallowed_tools: z.array(z.string().min(1)).optional(),
}).strict();

export const MemorySchema = z.object({
  max_tokens: z.number().int().positive().default(defaults.memory.max_tokens),
  max_lines: z.number().int().positive().default(defaults.memory.max_lines),
  warn_at: z.number().int().positive().default(defaults.memory.warn_at),
}).partial().strict();

export const McpServerSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  enabled: z.boolean().optional(),
}).strict();

export const ProjectConfigSchema = z.object({
  model: z.string().min(1).optional(),
  providers: ProvidersSchema.optional(),
  permissions: PermissionsSchema.optional(),
  memory: MemorySchema.optional(),
  mcp_servers: z.array(McpServerSchema).optional(),
  log_level: z.string().min(1).optional(),
}).strict();

export const GlobalConfigSchema = z.object({
  default_model: z.string().min(1).optional(),
  providers: ProvidersSchema.optional(),
  permissions: PermissionsSchema.optional(),
  memory: MemorySchema.optional(),
  mcp_servers: z.array(McpServerSchema).optional(),
  log_level: z.string().min(1).optional(),
}).strict();

const ResolvedProviderConfigSchema = z.object({
  apiKey: z.string().nullable(),
  baseUrl: z.string().nullable(),
}).strict();

const ResolvedProvidersSchema = z.object({
  anthropic: ResolvedProviderConfigSchema,
  openai: ResolvedProviderConfigSchema,
  google: ResolvedProviderConfigSchema,
  groq: ResolvedProviderConfigSchema,
  mistral: ResolvedProviderConfigSchema,
  deepseek: ResolvedProviderConfigSchema,
  xai: ResolvedProviderConfigSchema,
  perplexity: ResolvedProviderConfigSchema,
  together: ResolvedProviderConfigSchema,
  fireworks: ResolvedProviderConfigSchema,
  cohere: ResolvedProviderConfigSchema,
  openrouter: ResolvedProviderConfigSchema,
  ollama: ResolvedProviderConfigSchema,
}).strict();

const ResolvedPermissionsSchema = z.object({
  mode: PermissionModeSchema,
  allowed_tools: z.array(z.string()),
  disallowed_tools: z.array(z.string()),
}).strict();

const ResolvedMemorySchema = z.object({
  max_tokens: z.number().int().positive(),
  max_lines: z.number().int().positive(),
  warn_at: z.number().int().positive(),
}).strict();

const ResolvedMcpServerSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  enabled: z.boolean(),
}).strict();

export const ResolvedConfigSchema = z.object({
  model: z.string().min(1),
  default_model: z.string().min(1),
  providers: ResolvedProvidersSchema,
  permissions: ResolvedPermissionsSchema,
  memory: ResolvedMemorySchema,
  mcp_servers: z.array(ResolvedMcpServerSchema),
  context_text: z.string(),
  log_level: z.string().min(1),
}).strict();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProvidersConfig = z.infer<typeof ProvidersSchema>;
export type PermissionsConfig = z.infer<typeof PermissionsSchema>;
export type MemoryConfig = z.infer<typeof MemorySchema>;
export type McpServerConfig = z.infer<typeof McpServerSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

export type IrisConfig = ResolvedConfig;
