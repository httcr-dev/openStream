import { Injectable, Logger } from '@nestjs/common';
import type { MediaRef, PlaybackProvider, PlaybackSource } from '../provider.types.js';
import { ProviderSearchError } from '../provider.types.js';
import { AddonRegistryService } from './addon-registry.service.js';
import type { RegisteredAddon, StremioStream } from './addon.types.js';

const FORBIDDEN_COOLDOWN_MS = 15 * 60_000;

function supportsType(addon: RegisteredAddon, type: 'movie' | 'series'): boolean {
  const declaredTypes = addon.manifest.types;
  if (declaredTypes?.length && !declaredTypes.includes(type)) return false;
  const streamResource = addon.manifest.resources.find((resource) =>
    typeof resource === 'string' ? resource === 'stream' : resource.name === 'stream',
  );
  if (streamResource && typeof streamResource !== 'string' && streamResource.types?.length) {
    return streamResource.types.includes(type);
  }
  return true;
}

function supportsId(addon: RegisteredAddon, id: string): boolean {
  const prefixes = addon.manifest.idPrefixes;
  if (!prefixes?.length) return true;
  return prefixes.some((prefix) => id.startsWith(prefix));
}

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
  readonly note = 'Addons compatíveis com o protocolo Stremio, consultados automaticamente.';
  private readonly logger = new Logger(StremioAddonProvider.name);
  private readonly forbiddenCooldowns = new Map<string, number>();

  constructor(private readonly registry: AddonRegistryService) {}

  isEnabled(): boolean {
    return this.registry.enabled().length > 0;
  }

  async findSources(ref: MediaRef): Promise<PlaybackSource[]> {
    const contentId = stremioContentId(ref);
    if (!contentId) return [];
    const type = ref.kind === 'movie' ? 'movie' : 'series';
    const eligible = this.registry.enabled().filter((addon) =>
      supportsType(addon, type) && supportsId(addon, contentId),
    );

    const failures: { provider: string; message: string }[] = [];
    const now = Date.now();
    const addons = eligible.filter((addon) => {
      const until = this.forbiddenCooldowns.get(addon.manifest.id);
      if (!until) return true;
      if (until <= now) {
        this.forbiddenCooldowns.delete(addon.manifest.id);
        return true;
      }
      const remainingMinutes = Math.max(1, Math.ceil((until - now) / 60_000));
      failures.push({
        provider: addon.manifest.name,
        message: `HTTP 403 anterior; consulta pausada por mais ${remainingMinutes} min. Confira a configuração e a URL do manifest do addon.`,
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
                target: { kind: 'native' as const, transport, url: url.toString() },
              }];
            }

            if (stream.ytId && /^[\w-]{11}$/.test(stream.ytId)) {
              return [{
                id, provider: addon.manifest.name, providerId: addon.manifest.id, label,
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
          if (status === 403) {
            this.forbiddenCooldowns.set(addon.manifest.id, Date.now() + FORBIDDEN_COOLDOWN_MS);
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
