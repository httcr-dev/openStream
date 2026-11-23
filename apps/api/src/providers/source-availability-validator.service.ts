import { Injectable, Logger } from '@nestjs/common';
import type { PlaybackSource } from './provider.types.js';
import { TtlCache } from './ttl-cache.js';
import { SourceUrlSafetyService } from './source-url-safety.service.js';

export type SourceAvailabilityStatus = 'available' | 'unavailable' | 'unknown';

export interface SourceAvailability {
  status: SourceAvailabilityStatus;
  checkedAt: string;
  latencyMs?: number;
  contentType?: string;
  reason?: string;
}

interface ProbeResult {
  status: SourceAvailabilityStatus;
  latencyMs?: number;
  contentType?: string;
  reason?: string;
}

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_HLS_BYTES = 256 * 1024;
const CACHE_TTL_MS = 30_000;
const MAX_CONCURRENCY = 8;

@Injectable()
export class SourceAvailabilityValidatorService {
  private readonly logger = new Logger(SourceAvailabilityValidatorService.name);
  private readonly cache = new TtlCache<ProbeResult>(CACHE_TTL_MS);

  constructor(private readonly safety: SourceUrlSafetyService) {}

  async validate(sources: PlaybackSource[]): Promise<PlaybackSource[]> {
    const output = new Array<PlaybackSource>(sources.length);
    let next = 0;

    await Promise.all(Array.from(
      { length: Math.min(MAX_CONCURRENCY, sources.length) },
      async () => {
        while (true) {
          const index = next++;
          if (index >= sources.length) return;
          const source = sources[index];
          const checkedAt = new Date().toISOString();

          if (source.target.kind !== 'native') {
            output[index] = {
              ...source,
              availability: {
                status: 'unknown',
                checkedAt,
                reason: source.target.kind === 'embed'
                  ? 'Embed exige validação no player.'
                  : 'Torrent exige conexão com peers.',
              },
            };
            continue;
          }

          const key = `${source.target.transport}:${source.target.url}`;
          try {
            const result = await this.cache.getOrSet(key, () => this.probe(source));
            if (result.status === 'unavailable') continue;
            output[index] = {
              ...source,
              availability: { ...result, checkedAt },
            };
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.debug(`Validação falhou para ${source.id}: ${reason}`);
            output[index] = {
              ...source,
              availability: { status: 'unknown', checkedAt, reason: 'Falha temporária durante a validação.' },
            };
          }
        }
      },
    ));

    return output.filter((source): source is PlaybackSource => Boolean(source));
  }

  private async probe(source: PlaybackSource): Promise<ProbeResult> {
    const startedAt = Date.now();
    const initialUrl = source.target.kind === 'native' ? source.target.url : '';
    let currentUrl = initialUrl;

    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (!await this.safety.isSafe(currentUrl)) {
        return { status: 'unavailable', latencyMs: Date.now() - startedAt, reason: 'Destino inseguro ou inacessível.' };
      }

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          headers: source.target.transport === 'hls'
            ? { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*' }
            : { Range: 'bytes=0-0', Accept: '*/*' },
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const reason = error instanceof Error && error.name === 'TimeoutError'
          ? 'Timeout ao consultar a origem.'
          : 'Não foi possível conectar à origem.';
        return { status: 'unavailable', latencyMs: Date.now() - startedAt, reason };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location || redirect === MAX_REDIRECTS) {
          return { status: 'unavailable', latencyMs: Date.now() - startedAt, reason: 'Redirecionamento inválido ou excessivo.' };
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          return { status: 'unavailable', latencyMs: Date.now() - startedAt, reason: 'URL de redirecionamento inválida.' };
        }
        continue;
      }

      const contentType = response.headers.get('content-type') ?? undefined;
      if ((response.status !== 200 && response.status !== 206) || !response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { status: 'unavailable', latencyMs: Date.now() - startedAt, contentType, reason: `Origem respondeu HTTP ${response.status}.` };
      }

      if (source.target.transport === 'http' && /^(?:text\/html|application\/json)(?:;|$)/i.test(contentType ?? '')) {
        await response.body?.cancel().catch(() => undefined);
        return { status: 'unavailable', latencyMs: Date.now() - startedAt, contentType, reason: 'A origem não retornou um recurso de mídia.' };
      }

      if (source.target.transport === 'hls') {
        const playlist = await this.readLimitedText(response, MAX_HLS_BYTES);
        if (!playlist || !/^\s*#EXTM3U(?:\s|$)/m.test(playlist) ||
            !(/#EXTINF:/m.test(playlist) || /#EXT-X-STREAM-INF:/m.test(playlist))) {
          return { status: 'unavailable', latencyMs: Date.now() - startedAt, contentType, reason: 'Playlist HLS inválida ou vazia.' };
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }

      return { status: 'available', latencyMs: Date.now() - startedAt, contentType };
    }

    return { status: 'unavailable', latencyMs: Date.now() - startedAt, reason: 'Limite de redirecionamentos excedido.' };
  }

  private async readLimitedText(response: Response, maxBytes: number): Promise<string | null> {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  }
}
