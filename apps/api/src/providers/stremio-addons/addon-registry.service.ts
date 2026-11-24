import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RegisteredAddon, StremioManifest, StremioResource } from './addon.types.js';

const REQUEST_TIMEOUT_MS = 5_000;
const DIRECTORY_TIMEOUT_MS = 5_000;
const DIRECTORY_PAGE_SIZE = 100;
const MAX_DIRECTORY_PAGES = 2;
const MANIFEST_CONCURRENCY = 10;
const DEFAULT_DIRECTORY_URL = 'https://addons-stremio.com/api/v1/addons';

type DirectoryEntry = {
  manifestUrl?: unknown;
  manifest_url?: unknown;
  manifestURL?: unknown;
  transportUrl?: unknown;
  endpoint?: unknown;
  instances?: unknown;
};

type DirectoryResponse = {
  addons?: unknown;
  data?: unknown;
  results?: unknown;
  items?: unknown;
  pagination?: { total?: unknown; totalPages?: unknown; hasNextPage?: unknown };
};

export function supportsStream(manifest: StremioManifest): boolean {
  return manifest.resources.some((resource: StremioResource) =>
    typeof resource === 'string' ? resource === 'stream' : resource.name === 'stream',
  );
}

function normalizeBaseUrl(manifestUrl: string): string {
  const url = new URL(manifestUrl);
  const suffix = '/manifest.json';

  let pathname = url.pathname;

  if (pathname.toLowerCase().endsWith(suffix)) {
    pathname = pathname.slice(0, -suffix.length);
  }

  pathname = pathname.replace(/\/+$/, '');
  url.pathname = pathname || '/';
  url.hash = '';

  const serialized = url.toString();
  return serialized.endsWith('/')
    ? serialized.slice(0, -1)
    : serialized;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    return value === '::' || value === '::1' || value.startsWith('fc') ||
      value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') ||
      value.startsWith('fea') || value.startsWith('feb') || value.startsWith('::ffff:');
  }
  return true;
}

/** Rejects local/private targets before the API server makes outbound requests. */
export async function isSafeAddonUrl(value: string): Promise<boolean> {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace('[', '').replace(']', '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
    if (isIP(hostname)) return !isPrivateIp(hostname);
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateIp(address));
  } catch {
    return false;
  }
}

function readManifestUrls(value: unknown, output: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) readManifestUrls(item, output);
    return;
  }
  const entry = value as DirectoryEntry;
  for (const candidate of [entry.manifestUrl, entry.manifest_url, entry.manifestURL, entry.transportUrl, entry.endpoint]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const trimmed = candidate.trim();
      try {
        const candidateUrl = new URL(trimmed);
        let pathname = candidateUrl.pathname.replace(/\/+$/, '');
        if (!pathname.toLowerCase().endsWith('/manifest.json')) {
          pathname += '/manifest.json';
        }
        candidateUrl.pathname = pathname || '/manifest.json';
        output.add(candidateUrl.toString());
      } catch {
        // Ignore malformed directory entries.
      }
    }
  }
  if (entry.instances) readManifestUrls(entry.instances, output);
}

export function collectManifestUrls(value: unknown): string[] {
  const urls = new Set<string>();
  readManifestUrls(value, urls);
  return [...urls];
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

@Injectable()
export class AddonRegistryService implements OnModuleInit {
  private readonly logger = new Logger(AddonRegistryService.name);
  private readonly addons = new Map<string, RegisteredAddon>();
  private readonly health = new Map<string, { successes: number; failures: number; totalLatencyMs: number; lastCheckedAt?: string }>();

  constructor(private readonly config: ConfigService) {}

  private initialization: Promise<RegisteredAddon[]> = Promise.resolve([]);

  onModuleInit(): void {
    // Discovery runs in the background so a slow third-party directory cannot block API startup.
    this.initialization = this.refresh();
  }

  async waitUntilReady(): Promise<void> {
    await this.initialization;
  }

  discoveryEnabled(): boolean {
    return this.config.get<string>('STREMIO_ADDON_DISCOVERY_ENABLED') === 'true';
  }

  async refresh(): Promise<RegisteredAddon[]> {
    const discoveredUrls = this.discoveryEnabled() ? await this.discoverManifestUrls() : [];
    const manualUrls = (this.config.get<string>('STREMIO_ADDON_URLS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    // Directory entries are loaded first; explicit user configuration wins on duplicate IDs.
    const uniqueDiscovered = [...new Set(discoveredUrls)];
    const uniqueManual = [...new Set(manualUrls)];
    const allowedIds = this.allowedAddonIds();
    const discovered = await mapWithConcurrency(uniqueDiscovered, MANIFEST_CONCURRENCY, (url) => this.register(url, 'directory', allowedIds));
    // Run manual URLs last so a user's configured instance overrides a directory listing.
    const manual = await mapWithConcurrency(uniqueManual, MANIFEST_CONCURRENCY, (url) => this.register(url, 'manual', allowedIds));
    const registered = [...discovered, ...manual];
    const uniqueReady = new Set(registered.filter((addon) => addon.status === 'ready').map((addon) => addon.manifest.id));
    this.logger.log(`Registro Stremio: ${uniqueReady.size} addon(s) válidos (${uniqueDiscovered.length} descobertos, ${uniqueManual.length} manuais).`);
    return registered;
  }

  private async discoverManifestUrls(): Promise<string[]> {
    const directoryUrl = this.config.get<string>('STREMIO_ADDON_DIRECTORY_URL') ?? DEFAULT_DIRECTORY_URL;
    const urls = new Set<string>();
    try {
      for (let page = 0; page < MAX_DIRECTORY_PAGES; page += 1) {
        const url = new URL(directoryUrl);
        url.searchParams.set('sort', 'stars');
        url.searchParams.set('limit', String(DIRECTORY_PAGE_SIZE));
        url.searchParams.set('offset', String(page * DIRECTORY_PAGE_SIZE));
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Directory respondeu HTTP ${response.status}`);
        const payload = (await response.json()) as DirectoryResponse;
        const entries = [payload.addons, payload.data, payload.results, payload.items].find(Array.isArray) ?? [];
        for (const manifestUrl of collectManifestUrls(entries)) urls.add(manifestUrl);
        const total = Number(payload.pagination?.total);
        const totalPages = Number(payload.pagination?.totalPages);
        const hasNextPage = payload.pagination?.hasNextPage;
        if (entries.length < DIRECTORY_PAGE_SIZE ||
            hasNextPage === false ||
            (Number.isFinite(totalPages) && totalPages > 0 && page + 1 >= totalPages) ||
            (Number.isFinite(total) && total > 0 && (page + 1) * DIRECTORY_PAGE_SIZE >= total)) break;
      }
      const candidates = [...urls];
      const safety = await mapWithConcurrency(candidates, 30, isSafeAddonUrl);
      const safeUrls = candidates.filter((url, index) => {
        if (safety[index]) return true;
        this.logger.warn(`Addon descoberto ignorado por URL insegura ou inacessível: ${url}`);
        return false;
      });
      this.logger.log(`Directory Stremio: ${safeUrls.length} manifest(s) públicos encontrados.`);
      return safeUrls;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Descoberta automática indisponível; mantendo addons manuais: ${message}`);
      return [];
    }
  }

  private allowedAddonIds(): string[] {
    return (this.config.get<string>('STREMIO_ADDON_ALLOWED_IDS') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  }

  private async register(manifestUrl: string, source: 'directory' | 'manual', allowedIds: string[] = []): Promise<RegisteredAddon> {
    try {
      const parsed = new URL(manifestUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Protocolo de URL inválido');
      if (!await isSafeAddonUrl(manifestUrl)) throw new Error('URL insegura ou inacessível');
      const response = await fetch(manifestUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Manifest respondeu HTTP ${response.status}`);
      const manifest = (await response.json()) as StremioManifest;
      if (!manifest.id || !manifest.name || !Array.isArray(manifest.resources)) {
        throw new Error('Manifest inválido: id, name e resources são obrigatórios');
      }
      if (!allowedIds.includes(manifest.id)) {
        throw new Error(`Addon ${manifest.id} não está na allowlist STREMIO_ADDON_ALLOWED_IDS`);
      }
      const addon: RegisteredAddon = {
        manifestUrl,
        baseUrl: normalizeBaseUrl(manifestUrl),
        manifest,
        status: 'ready',
        source,
      };
      this.addons.set(manifest.id, addon);
      return addon;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Não foi possível carregar addon ${manifestUrl}: ${message}`);
      const failed: RegisteredAddon = {
        manifestUrl,
        baseUrl: '',
        manifest: { id: manifestUrl, version: '', name: manifestUrl, resources: [] },
        status: 'error',
        source,
        error: message,
      };
      this.addons.set(manifestUrl, failed);
      return failed;
    }
  }

  list(): RegisteredAddon[] {
    return [...this.addons.values()];
  }

  enabled(): RegisteredAddon[] {
    return this.list().filter((addon) => addon.status === 'ready' && addon.source === 'manual' &&
      supportsStream(addon.manifest) && this.allowedAddonIds().includes(addon.manifest.id) &&
      !addon.manifest.behaviorHints?.configurationRequired);
  }

  getStats() {
    const addons = this.list();
    const ready = addons.filter((addon) => addon.status === 'ready');
    const enabled = this.enabled();
    const health = [...this.health.values()];
    const requests = health.reduce((sum, item) => sum + item.successes + item.failures, 0);
    const successes = health.reduce((sum, item) => sum + item.successes, 0);
    return {
      discoveryEnabled: this.discoveryEnabled(),
      discovered: addons.filter((addon) => addon.source === 'directory').length,
      manuallyConfigured: addons.filter((addon) => addon.source === 'manual').length,
      ready: ready.length,
      enabled: enabled.length,
      rejected: addons.filter((addon) => addon.status === 'error').length,
      requests,
      successRate: requests ? successes / requests : null,
    };
  }

  recordRequest(addonId: string, success: boolean, latencyMs: number): void {
    const current = this.health.get(addonId) ?? { successes: 0, failures: 0, totalLatencyMs: 0 };
    if (success) current.successes += 1;
    else current.failures += 1;
    current.totalLatencyMs += latencyMs;
    current.lastCheckedAt = new Date().toISOString();
    this.health.set(addonId, current);
  }

  getHealth(addonId: string) {
    const value = this.health.get(addonId);
    if (!value) return { requests: 0, successRate: null, averageLatencyMs: null, score: 0 };
    const requests = value.successes + value.failures;
    const successRate = requests ? value.successes / requests : 0;
    const averageLatencyMs = requests ? Math.round(value.totalLatencyMs / requests) : 0;
    return {
      requests, successRate, averageLatencyMs, lastCheckedAt: value.lastCheckedAt,
      score: Math.round(successRate * 1000 - averageLatencyMs / 100),
    };
  }
}

export function getAddonResources(manifest: StremioManifest): string[] {
  return manifest.resources.map((resource) =>
    typeof resource === 'string' ? resource : resource.name,
  );
}

export function hasAddonResource(manifest: StremioManifest, resourceName: string): boolean {
  return getAddonResources(manifest).includes(resourceName);
}

export { normalizeBaseUrl };
