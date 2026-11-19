export type StremioResource = string | { name: string; types?: string[]; idPrefixes?: string[] };

export interface StremioManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  resources: StremioResource[];
  types?: string[];
  idPrefixes?: string[];
  catalogs?: Array<{ type: string; id: string; name?: string }>;
  behaviorHints?: { configurable?: boolean; configurationRequired?: boolean };
}

export interface RegisteredAddon {
  manifestUrl: string;
  baseUrl: string;
  manifest: StremioManifest;
  status: 'ready' | 'error';
  error?: string;
}

export interface StremioStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  sources?: string[];
  behaviorHints?: { notWebReady?: boolean; proxyHeaders?: unknown };
}
