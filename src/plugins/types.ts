export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  license?: string;
  homepage?: string;
  keywords?: string[];
}

export interface PluginComponents {
  commands: string[];
  agents: string[];
  skills: string[];
  hooks: string | null;
  mcpConfig: string | null;
}

export interface Plugin {
  manifest: PluginManifest;
  components: PluginComponents;
  rootDir: string;
  status: 'loaded' | 'error';
  error?: string;
}

export interface PluginLoadResult {
  plugins: Plugin[];
  errors: Array<{ path: string; error: string }>;
}

export interface MarketplaceEntry {
  name: string;
  source: string;
  description: string;
  version: string;
}

export interface MarketplaceIndex {
  name: string;
  plugins: MarketplaceEntry[];
}
