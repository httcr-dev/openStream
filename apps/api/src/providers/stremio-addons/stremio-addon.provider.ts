import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaRef, PlaybackProvider, PlaybackSource } from '../provider.types.js';
import { ProviderSearchError } from '../provider.types.js';
import { normalizeReleaseMetadata } from '../release-normalizer.js';
import { AddonRegistryService } from './addon-registry.service.js';
import type { RegisteredAddon, StremioStream } from './addon.types.js';
import { cooldownForStatus, isManifestEligible } from './addon-policy.js';

const MAX_COOLDOWNS = 500;

function isValidInfoHash(value: string): boolean {
  return /^(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(value);
}

function extractTrackers(sources: string[] = []): string[] {
  return [...new Set(sources
    .filter((source) => source.startsWith('tracker:'))
    .map((source) => source.slice('tracker:'.length))
    .filter((tracker) => {
      try {
        return ['udp:', 'http:', 'https:', 'ws:', 'wss:'].includes(new URL(tracker).protocol);
      } catch {
        return false;
      }
    }))].slice(0, 20);
}

export function stremioContentId(ref: MediaRef): string | null {
  if (!ref.imdbId) return null;
  if (ref.kind === 'movie') return ref.imdbId;
  if (ref.season === undefined || ref.episode === undefined) return null;
  return `${ref.imdbId}:${ref.season}:${ref.episode}`;
}

function streamUrl(addon: RegisteredAddon, type: 'movie' | 'series', contentId: string): string {
  const url = new URL(addon.baseUrl);
  const prefix = url.pathname.replace(/\/$/, '');
  url.pathname = `${prefix}/stream/${type}/${encodeURIComponent(contentId).replace(/%3A/gi, ':')}.json`;
  return url.toString();
}

@Injectable()
export class StremioAddonProvider implements PlaybackProvider {
  readonly id = 'stremio-addons';
  readonly name = 'Stremio Addons';
  readonly playerKind = 'native' as const;
  readonly note = 'Addons explicitamente allowlisted e com autorização declarada.';
  private readonly logger = new Logger(StremioAddonProvider.name);
  private readonly cooldowns = new Map<string, { until: number; status: number }>();

  constructor(
    private readonly registry: AddonRegistryService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.registry.enabled().length > 0;
  }

  private authorizationFor(addonId: string): PlaybackSource['authorization'] | undefined {
    const raw = this.config.get<string>('STREMIO_ADDON_AUTHORIZATIONS');
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Record<string, { status?: string; licenseUrl?: string }>;
      const value = parsed[addonId];
      if (!value || !value.licenseUrl || !['public-domain', 'creative-commons', 'licensed', 'user-owned'].includes(value.status ?? '')) return undefined;
      const url = new URL(value.licenseUrl);
      if (url.protocol !== 'https:') return undefined;
      return { status: value.status as NonNullable<PlaybackSource['authorization']>['status'], licenseUrl: url.toString() };
    } catch {
      return undefined;
    }
  }

  async findSources(ref: MediaRef): Promise<PlaybackSource[]> {
    await this.registry.waitUntilReady();
    const contentId = stremioContentId(ref);
    if (!contentId) return [];
    const type = ref.kind === 'movie' ? 'movie' : 'series';
    const eligible = this.registry.enabled().filter((addon) =>
      isManifestEligible(addon.manifest, type, contentId),
    );

    const failures: { provider: string; message: string }[] = [];
    const now = Date.now();
    const addons = eligible.filter((addon) => {
      const cooldownKey = `${addon.manifest.id}:${contentId}`;
      const cooldown = this.cooldowns.get(cooldownKey) ?? this.cooldowns.get(addon.manifest.id);
      if (!cooldown) return true;
      if (cooldown.until <= now) {
        this.cooldowns.delete(addon.manifest.id);
        return true;
      }
      const remainingMinutes = Math.max(1, Math.ceil((cooldown.until - now) / 60_000));
      failures.push({
        provider: addon.manifest.name,
        message: `HTTP ${cooldown.status} anterior; consulta pausada por mais ${remainingMinutes} min. Confira a configuração e a URL do manifest do addon.`,
      });
      return false;
    });

    const results = await Promise.allSettled(
      addons.map(async (addon) => {
        const startedAt = Date.now();
        try {
          const response = await fetch(streamUrl(addon, type, contentId), {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          });

          if (!response.ok) {
            const responseBody = await response.text().catch(() => '');
            const details = responseBody.slice(0, 300);
            throw new Error(
              `${addon.manifest.name}: HTTP ${response.status}` +
                (details ? ` - ${details}` : ''),
            );
          }

          const data = (await response.json()) as { streams?: StremioStream[] };
          this.registry.recordRequest(addon.manifest.id, true, Date.now() - startedAt);

          return (data.streams ?? []).flatMap((stream, index): PlaybackSource[] => {
            const label = [stream.name, stream.title, stream.description]
              .filter(Boolean)
              .join(' · ') || addon.manifest.name;
            const id = `${addon.manifest.id}:${contentId}:${index}`;
            const release = normalizeReleaseMetadata({
              title: stream.title ?? stream.name,
              description: stream.description,
              size: stream.size,
              seeders: stream.seeders,
            });
            const hasRelease = Boolean(release.title || release.year || release.season || release.quality ||
              release.codec || release.audio || release.subtitles.length || release.sizeBytes || release.seeders !== undefined);

            if (stream.url) {
              let url: URL;
              try {
                url = new URL(stream.url);
              } catch {
                return [];
              }
              if (!['http:', 'https:'].includes(url.protocol) || stream.behaviorHints?.proxyHeaders) {
                return [];
              }
              const transport = /\.m3u8(?:$|\?)/i.test(url.href) ? 'hls' : 'http';
              return [{
                id, provider: addon.manifest.name, providerId: addon.manifest.id, label,
                ...(hasRelease ? { release, quality: release.quality } : {}),
                ...(this.authorizationFor(addon.manifest.id) ? { authorization: this.authorizationFor(addon.manifest.id) } : {}),
                target: { kind: 'native' as const, transport, url: url.toString() },
              }];
            }

            if (stream.ytId && /^[\w-]{11}$/.test(stream.ytId)) {
              return [{
                id, provider: addon.manifest.name, providerId: addon.manifest.id, label,
                ...(hasRelease ? { release, quality: release.quality } : {}),
                ...(this.authorizationFor(addon.manifest.id) ? { authorization: this.authorizationFor(addon.manifest.id) } : {}),
                target: {
                  kind: 'embed' as const,
                  provider: 'youtube',
                  embedUrl: `https://www.youtube-nocookie.com/embed/${stream.ytId}`,
                },
              }];
            }

            if (stream.infoHash && isValidInfoHash(stream.infoHash)) {
              const trackers = extractTrackers(stream.sources);
              return [{
                id, provider: addon.manifest.name, providerId: addon.manifest.id, label,
                ...(hasRelease ? { release, quality: release.quality } : {}),
                target: {
                  kind: 'torrent' as const,
                  infoHash: stream.infoHash.toLowerCase(),
                  ...(Number.isInteger(stream.fileIdx) ? { fileIdx: stream.fileIdx } : {}),
                  ...(trackers.length ? { trackers } : {}),
                  ...(stream.externalUrl ? { externalUrl: stream.externalUrl } : {}),
                },
              }];
            }
            return [];
          });
        } catch (error) {
          this.registry.recordRequest(addon.manifest.id, false, Date.now() - startedAt);
          const message = error instanceof Error ? error.message : String(error);
          const status = Number(/HTTP (\d{3})/.exec(message)?.[1] ?? 0);
          
          const cooldownMs = cooldownForStatus(status);
          if (cooldownMs > 0) {
            const scopedKey = status === 400 || status === 404 || status === 410
              ? `${addon.manifest.id}:${contentId}`
              : addon.manifest.id;
            this.cooldowns.delete(scopedKey);
            this.cooldowns.set(scopedKey, { until: Date.now() + cooldownMs, status });
            while (this.cooldowns.size > MAX_COOLDOWNS) {
              const oldest = this.cooldowns.keys().next().value;
              if (!oldest) break;
              this.cooldowns.delete(oldest);
            }
          }
          const configurationHint = status === 403 && addon.manifest.id.toLowerCase().includes('comet')
            ? ' Verifique se STREMIO_ADDON_URLS contém a URL de manifest gerada pela página /configure do Comet; a URL pública sem configuração pode responder 403.'
            : '';
          this.logger.warn(`Addon ${addon.manifest.name} falhou para ${contentId}: ${message}${configurationHint}`);
          throw new Error(`${message}${configurationHint}`);
        }
      }),
    );

    const sources: PlaybackSource[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sources.push(...result.value);
      } else {
        const reason = result.reason;
        failures.push({
          provider: addons[index].manifest.name,
          message: reason instanceof Error ? reason.message : String(reason),
        });
      }
    });

    sources.sort((a, b) =>
      this.registry.getHealth(b.providerId ?? '').score - this.registry.getHealth(a.providerId ?? '').score,
    );

    if (failures.length) {
      throw new ProviderSearchError(
        `${failures.length} addon(s) falharam ou estão temporariamente suspensos`,
        sources,
        failures,
      );
    }
    return sources;
  }
}
