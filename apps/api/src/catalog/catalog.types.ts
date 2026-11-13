export type MediaKind = 'movie' | 'series';

/** Item de catálogo. O id interno é `tmdb:movie:{id}` ou `tmdb:series:{id}`. */
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

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface CatalogDetail extends CatalogItem {
  imdbId?: string;
  seasons?: SeasonSummary[];
}

export interface EpisodeSummary {
  episodeNumber: number;
  name: string;
  overview: string;
  stillUrl?: string;
}
