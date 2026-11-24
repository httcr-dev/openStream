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
  | { kind: 'embed'; provider: string; embedUrl: string }
  | { kind: 'torrent'; infoHash: string; fileIdx?: number; trackers?: string[]; externalUrl?: string };

export interface PlaybackSource {
  id: string;
  provider: string;
  providerId?: string;
  label: string;
  quality?: string;
  target: PlaybackTarget;
}

export interface ResolveResult {
  media: { id: string; title: string; kind?: MediaKind; season?: number; episode?: number };
  sources: PlaybackSource[];
  errors: { provider: string; message: string }[];
}

export interface FailoverResult {
  media: ResolveResult['media'];
  nextSource: PlaybackSource | null;
  sources: PlaybackSource[];
  exhausted: boolean;
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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      message = ((await res.json()) as { message?: string }).message ?? message;
    } catch {}
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function torrentStreamUrl(target: Extract<PlaybackTarget, { kind: 'torrent' }>): string {
  const url = new URL(
    `${API_URL.replace(/\/$/, '')}/playback/torrents/${encodeURIComponent(target.infoHash)}/${target.fileIdx ?? -1}/stream`,
  );
  for (const tracker of target.trackers ?? []) url.searchParams.append('tracker', tracker);
  return url.toString();
}

export const api = {
  search: (q: string) => get<CatalogItem[]>(`/catalog/search?q=${encodeURIComponent(q)}`),
  detail: (kind: MediaKind, tmdbId: string) => get<CatalogDetail>(`/catalog/${kind}/${tmdbId}`),
  episodes: (tmdbId: string, season: number) =>
    get<Episode[]>(`/catalog/series/${tmdbId}/seasons/${season}`),
  sources: (id: string, season?: number, episode?: number, provider?: string) => {
    const qs = new URLSearchParams({ id });
    if (season !== undefined) qs.set('season', String(season));
    if (episode !== undefined) qs.set('episode', String(episode));
    if (provider) qs.set('provider', provider);
    return get<ResolveResult>(`/playback/sources?${qs}`);
  },
  failover: (input: {
    id: string;
    season?: number;
    episode?: number;
    provider?: string;
    failedSourceIds: string[];
    failedSourceId: string;
    reason: string;
  }) => post<FailoverResult>('/playback/failover', input),
  addons: () => get<{ id: string; name: string; description?: string; status: 'ready' | 'error'; error?: string; resources: unknown[]; health?: { requests: number; successRate: number | null; averageLatencyMs: number | null; score: number } }[]>('/addons'),
  providers: () => get<ProviderDescriptor[]>('/providers'),
};
