import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JellyfinClient, type JellyfinItem } from './jellyfin.client.js';
import type { MediaRef, PlaybackProvider, PlaybackSource } from '../provider.types.js';

const norm = (s?: string) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

@Injectable()
export class JellyfinProvider implements PlaybackProvider {
  readonly id = 'jellyfin';
  readonly name = 'Jellyfin (biblioteca própria)';
  readonly playerKind = 'native' as const;
  readonly note = 'Conteúdo da sua própria biblioteca. Direct Play e HLS via proxy do OpenStream.';

  constructor(
    private readonly client: JellyfinClient,
    private readonly config: ConfigService,
  ) {}

  isEnabled() {
    return this.client.isConfigured();
  }

  private get publicApi() {
    const base = this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3000';
    return `${base.replace(/\/+$/, '')}/api/v1`;
  }

  /** Correspondência por TMDB/IMDb ID; fallback por título normalizado + ano. */
  private matches(item: JellyfinItem, ref: MediaRef): boolean {
    const ids = item.ProviderIds ?? {};
    const tmdb = ids.Tmdb ?? ids.tmdb;
    if (tmdb) return tmdb === String(ref.tmdbId);
    const imdb = ids.Imdb ?? ids.imdb;
    if (imdb && ref.imdbId) return imdb === ref.imdbId;

    const names = [norm(ref.title), norm(ref.originalTitle)].filter(Boolean);
    if (!names.includes(norm(item.Name))) return false;
    return !ref.year || !item.ProductionYear || Math.abs(item.ProductionYear - ref.year) <= 1;
  }

  async findSources(ref: MediaRef): Promise<PlaybackSource[]> {
    const type = ref.kind === 'movie' ? 'Movie' : 'Series';
    const terms = [...new Set([ref.title, ref.originalTitle].filter((t): t is string => !!t))];

    const found = new Map<string, JellyfinItem>();
    for (const term of terms) {
      for (const item of await this.client.searchItems(term, type)) {
        if (this.matches(item, ref)) found.set(item.Id, item);
      }
    }
    const media = [...found.values()][0];
    if (!media) return [];

    let playableId = media.Id;
    let label = media.Name;
    if (ref.kind === 'series') {
      if (!ref.season || !ref.episode) return []; // séries exigem temporada/episódio
      const eps = await this.client.getEpisodes(media.Id, ref.season);
      const ep = eps.find((e) => e.IndexNumber === ref.episode);
      if (!ep) return [];
      playableId = ep.Id;
      label = `${media.Name} S${String(ref.season).padStart(2, '0')}E${String(ref.episode).padStart(2, '0')}`;
    }

    const root = `${this.publicApi}/stream/jellyfin/videos/${playableId}`;
    const direct = `${root}/stream?static=true&mediaSourceId=${playableId}`;
    const hlsParams = new URLSearchParams({
      mediaSourceId: playableId,
      videoCodec: 'h264',
      audioCodec: 'aac',
      segmentContainer: 'ts',
      minSegments: '1',
      breakOnNonKeyFrames: 'true',
      transcodingMaxAudioChannels: '2',
      playSessionId: `os-${playableId.slice(0, 8)}-${Date.now()}`,
      deviceId: 'openstream-web',
    });

    return [
      {
        id: `jellyfin:${playableId}:direct`,
        provider: this.id,
        label: `${label} — Direct Play`,
        quality: 'Original',
        target: { kind: 'native', transport: 'http', url: direct },
      },
      {
        id: `jellyfin:${playableId}:hls`,
        provider: this.id,
        label: `${label} — HLS (transcodificado)`,
        quality: 'Adaptado',
        target: { kind: 'native', transport: 'hls', url: `${root}/master.m3u8?${hlsParams}` },
      },
    ];
  }
}
