import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlCache } from '../providers/ttl-cache.js';
import type {
  CatalogDetail,
  CatalogItem,
  EpisodeSummary,
  MediaKind,
  SeasonSummary,
} from './catalog.types.js';

const DEFAULT_TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';
const DETAIL_CACHE_TTL_MS = 6 * 60 * 60_000;
const EPISODE_CACHE_TTL_MS = 6 * 60 * 60_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class CatalogService {
  private readonly detailCache = new TtlCache<CatalogDetail>(DETAIL_CACHE_TTL_MS);
  private readonly episodeCache = new TtlCache<EpisodeSummary[]>(EPISODE_CACHE_TTL_MS);

  constructor(private readonly config: ConfigService) {}

  private get language() {
    return this.config.get<string>('TMDB_LANGUAGE') ?? 'pt-BR';
  }

  private async tmdb<T = any>(path: string, params: Record<string, string> = {}): Promise<T> {
    const token = this.config.get<string>('TMDB_READ_TOKEN');
    if (!token) throw new ServiceUnavailableException('TMDB_READ_TOKEN não configurado.');
    const base = this.config.get<string>('TMDB_BASE_URL') ?? DEFAULT_TMDB_BASE;
    const url = new URL(`${base.replace(/\/+$/, '')}${path}`);
    url.searchParams.set('language', this.language);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new ServiceUnavailableException(`TMDB respondeu ${res.status} em ${path}`);
    return (await res.json()) as T;
  }

  static parseId(id: string): { kind: MediaKind; tmdbId: number } {
    const m = /^tmdb:(movie|series):(\d+)$/.exec(id);
    if (!m) throw new BadRequestException(`ID inválido: ${id}`);
    return { kind: m[1] as MediaKind, tmdbId: Number(m[2]) };
  }

  private img(path: string | null | undefined, size: string) {
    return path ? `${IMG_BASE}/${size}${path}` : undefined;
  }

  private yearOf(date?: string) {
    const y = date?.slice(0, 4);
    return y && /^\d{4}$/.test(y) ? Number(y) : undefined;
  }

  private mapItem(r: any, kind: MediaKind): CatalogItem {
    const isMovie = kind === 'movie';
    return {
      id: `tmdb:${kind}:${r.id}`,
      kind,
      tmdbId: r.id,
      title: (isMovie ? r.title : r.name) ?? '',
      originalTitle: (isMovie ? r.original_title : r.original_name) ?? '',
      year: this.yearOf(isMovie ? r.release_date : r.first_air_date),
      overview: r.overview ?? '',
      posterUrl: this.img(r.poster_path, 'w342'),
      backdropUrl: this.img(r.backdrop_path, 'w1280'),
      genres: Array.isArray(r.genres) ? r.genres.map((genre: any) => genre.name).filter(Boolean) : undefined,
      originalLanguage: r.original_language || undefined,
    };
  }

  async search(query: string): Promise<CatalogItem[]> {
    const q = query.trim();
    if (!q) return [];
    const data = await this.tmdb('/search/multi', { query: q, include_adult: 'false' });
    return (data.results as any[])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => this.mapItem(r, r.media_type === 'movie' ? 'movie' : 'series'));
  }

  async detail(kind: MediaKind, tmdbId: number): Promise<CatalogDetail> {
    const key = `${this.language}:${kind}:${tmdbId}`;
    return this.detailCache.getOrSet(key, async () => {
      if (kind === 'movie') {
        const r = await this.tmdb(`/movie/${tmdbId}`);
        return {
          ...this.mapItem(r, 'movie'),
          imdbId: r.imdb_id || undefined,
          externalIds: { imdbId: r.imdb_id || undefined },
          runtimeMinutes: Number.isFinite(r.runtime) ? r.runtime : undefined,
        };
      }

      const r = await this.tmdb(`/tv/${tmdbId}`, { append_to_response: 'external_ids' });
      const seasons: SeasonSummary[] = (r.seasons as any[])
        .filter((s) => s.season_number > 0)
        .map((s) => ({
          seasonNumber: s.season_number,
          name: s.name,
          episodeCount: s.episode_count,
        }));
      const externalIds = {
        ...(r.external_ids?.imdb_id ? { imdbId: r.external_ids.imdb_id } : {}),
        ...(r.external_ids?.tvdb_id ? { tvdbId: String(r.external_ids.tvdb_id) } : {}),
        ...(r.external_ids?.tvmaze_id ? { tvmazeId: String(r.external_ids.tvmaze_id) } : {}),
      };
      return {
        ...this.mapItem(r, 'series'),
        imdbId: externalIds.imdbId,
        externalIds,
        seasons,
      };
    });
  }

  async episodes(tmdbId: number, season: number): Promise<EpisodeSummary[]> {
    const key = `${this.language}:series:${tmdbId}:season:${season}`;
    return this.episodeCache.getOrSet(key, async () => {
      const r = await this.tmdb(`/tv/${tmdbId}/season/${season}`);
      return (r.episodes as any[]).map((e) => ({
        episodeNumber: e.episode_number,
        name: e.name,
        overview: e.overview ?? '',
        stillUrl: this.img(e.still_path, 'w300'),
        airDate: e.air_date || undefined,
        runtimeMinutes: Number.isFinite(e.runtime) ? e.runtime : undefined,
      }));
    });
  }
}
