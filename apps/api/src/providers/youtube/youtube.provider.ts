import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaRef, PlaybackProvider, PlaybackSource } from '../provider.types.js';
import { TtlCache } from '../ttl-cache.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class YouTubeProvider implements PlaybackProvider {
  readonly id = 'youtube';
  readonly name = 'YouTube';
  readonly playerKind = 'embed' as const;
  readonly note =
    'Player oficial do YouTube. Só aparecem vídeos que o dono permite incorporar; anúncios do YouTube não são alterados.';

  // search.list custa 100 unidades da cota diária (10.000); cache de 6h.
  private readonly cache = new TtlCache<PlaybackSource[]>(6 * 60 * 60 * 1000);

  constructor(private readonly config: ConfigService) {}

  isEnabled() {
    return Boolean(this.config.get<string>('YOUTUBE_API_KEY'));
  }

  async findSources(ref: MediaRef): Promise<PlaybackSource[]> {
    const q =
      ref.kind === 'movie'
        ? `${ref.title} ${ref.year ?? ''} filme completo`.trim()
        : `${ref.title} temporada ${ref.season ?? 1} episódio ${ref.episode ?? 1}`;
    return this.cache.getOrSet(q, () => this.search(q, ref.kind === 'movie'));
  }

  private async search(q: string, long: boolean): Promise<PlaybackSource[]> {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: '5',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      safeSearch: 'moderate',
      q,
      key: this.config.get<string>('YOUTUBE_API_KEY') ?? '',
      ...(long ? { videoDuration: 'long' } : {}),
    }).toString();

    const res = await fetch(url);
    if (!res.ok) throw new Error(`YouTube Data API respondeu ${res.status}`);
    const data = (await res.json()) as { items?: any[] };

    return (data.items ?? [])
      .filter((i) => i.id?.videoId)
      .map((i) => ({
        id: `youtube:${i.id.videoId}`,
        provider: this.id,
        label: `${i.snippet.title} — ${i.snippet.channelTitle}`,
        target: {
          kind: 'embed' as const,
          provider: this.id,
          embedUrl: `https://www.youtube-nocookie.com/embed/${i.id.videoId}?rel=0`,
        },
      }));
  }
}
