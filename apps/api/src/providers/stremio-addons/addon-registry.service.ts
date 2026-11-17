import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RegisteredAddon, StremioManifest, StremioResource } from './addon.types.js';

const REQUEST_TIMEOUT_MS = 8_000;

export function supportsStream(manifest: StremioManifest): boolean {
  return manifest.resources.some((resource: StremioResource) =>
    typeof resource === 'string' ? resource === 'stream' : resource.name === 'stream',
  );
}

function normalizeBaseUrl(manifestUrl: string): string {
  const url = new URL(manifestUrl);
  url.pathname = url.pathname.replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '');
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

@Injectable()
export class AddonRegistryService implements OnModuleInit {
  private readonly logger = new Logger(AddonRegistryService.name);
  private readonly addons = new Map<string, RegisteredAddon>();
  private readonly health = new Map<string, { successes: number; failures: number; totalLatencyMs: number; lastCheckedAt?: string }>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<RegisteredAddon[]> {
    const urls = (this.config.get<string>('STREMIO_ADDON_URLS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    return Promise.all(urls.map((url) => this.register(url)));
  }

  private async register(manifestUrl: string): Promise<RegisteredAddon> {
    try {
      const parsed = new URL(manifestUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Protocolo de URL inválido');
      const response = await fetch(manifestUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Manifest respondeu HTTP ${response.status}`);
      const manifest = (await response.json()) as StremioManifest;
      if (!manifest.id || !manifest.name || !Array.isArray(manifest.resources)) {
        throw new Error('Manifest inválido: id, name e resources são obrigatórios');
      }

      // Catálogo e legendas também são capabilities válidas. O provider de
      // playback filtra addons sem "stream" na hora de consultar fontes.
      const addon: RegisteredAddon = {
        manifestUrl,
        baseUrl: normalizeBaseUrl(manifestUrl),
        manifest,
        status: 'ready',
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
    return this.list().filter((addon) => addon.status === 'ready' && supportsStream(addon.manifest));
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

export { normalizeBaseUrl };
