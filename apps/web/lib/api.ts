export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

export type MediaKind = 'movie' | 'series';

export interface CatalogItem {
  id: string;
  kind: MediaKind;
  tmdbId: number;
  title: string;
  originalTitle: string;
  year?: number;
  overview: string;
  posterUrl?: string;
  backdropUrl?: string;
}

export interface CatalogDetail extends CatalogItem {
  imdbId?: string;
  seasons?: { seasonNumber: number; name: string; episodeCount: number }[];
}

export interface Episode {
  episodeNumber: number;
  name: string;
  overview: string;
  stillUrl?: string;
}

export type PlaybackTarget =
  | { kind: 'native'; transport: 'http' | 'hls'; url: string }
  | { kind: 'embed'; provider: string; embedUrl: string };

export interface PlaybackSource {
  id: string;
  provider: string;
  label: string;
  quality?: string;
  target: PlaybackTarget;
}

export interface ResolveResult {
  media: { id: string; title: string };
  sources: PlaybackSource[];
  errors: { provider: string; message: string }[];
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  enabled: boolean;
  playerKind: 'native' | 'embed';
  note?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      message = ((await res.json()) as { message?: string }).message ?? message;
    } catch {}
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  search: (q: string) => get<CatalogItem[]>(`/catalog/search?q=${encodeURIComponent(q)}`),
  detail: (kind: MediaKind, tmdbId: string) => get<CatalogDetail>(`/catalog/${kind}/${tmdbId}`),
  episodes: (tmdbId: string, season: number) =>
    get<Episode[]>(`/catalog/series/${tmdbId}/seasons/${season}`),
  sources: (id: string, season?: number, episode?: number) => {
    const qs = new URLSearchParams({ id });
    if (season) qs.set('season', String(season));
    if (episode) qs.set('episode', String(episode));
    return get<ResolveResult>(`/playback/sources?${qs}`);
  },
  providers: () => get<ProviderDescriptor[]>('/providers'),
};
