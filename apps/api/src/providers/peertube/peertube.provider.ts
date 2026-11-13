import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaRef, PlaybackProvider, PlaybackSource } from '../provider.types.js';
import { TtlCache } from '../ttl-cache.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class PeerTubeProvider implements PlaybackProvider {
  readonly id = 'peertube';
  readonly name = 'PeerTube';
  readonly playerKind = 'embed' as const;
  readonly note = 'Player oficial do PeerTube (rede federada, sem anúncios inseridos pelo OpenStream).';

  private readonly cache = new TtlCache<PlaybackSource[]>(60 * 60 * 1000);

  constructor(private readonly config: ConfigService) {}

  private get searchUrl() {
    return (this.config.get<string>('PEERTUBE_SEARCH_URL') ?? 'https://sepiasearch.org').replace(
      /\/+$/,
      '',
    );
  }

  isEnabled() {
    return (this.config.get<string>('PEERTUBE_ENABLED') ?? 'true') !== 'false';
  }

  async findSources(ref: MediaRef): Promise<PlaybackSource[]> {
    const q =
      ref.kind === 'movie'
        ? `${ref.title} ${ref.year ?? ''}`.trim()
        : `${ref.title} S${String(ref.season ?? 1).padStart(2, '0')}E${String(ref.episode ?? 1).padStart(2, '0')}`;
    return this.cache.getOrSet(q, () => this.search(q, ref.kind === 'movie'));
  }

  private async search(q: string, long: boolean): Promise<PlaybackSource[]> {
    const base = this.searchUrl;
    const params = new URLSearchParams({ search: q, count: '5', sort: '-match' });
    if (long) params.set('durationMin', String(40 * 60)); // ignora clipes curtos

    const res = await fetch(`${base}/api/v1/search/videos?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`PeerTube respondeu ${res.status}`);
    const data = (await res.json()) as { data?: any[] };

    return (data.data ?? []).flatMap((v): PlaybackSource[] => {
      const embedUrl: string | undefined =
        v.embedUrl ?? (v.url && v.uuid ? `${new URL(v.url).origin}/videos/embed/${v.uuid}` : undefined);
      if (!embedUrl) return [];
      return [
        {
          id: `peertube:${v.uuid}`,
          provider: this.id,
          label: `${v.name} — ${v.channel?.displayName ?? v.account?.displayName ?? 'PeerTube'}`,
          target: { kind: 'embed', provider: this.id, embedUrl },
        },
      ];
    });
  }
}
