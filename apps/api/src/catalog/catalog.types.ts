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
  genres?: string[];
  originalLanguage?: string;
}

export interface ExternalMediaIds {
  imdbId?: string;
  tvdbId?: string;
  tvmazeId?: string;
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface CatalogDetail extends CatalogItem {
  imdbId?: string;
  externalIds?: ExternalMediaIds;
  runtimeMinutes?: number;
  seasons?: SeasonSummary[];
}

export interface EpisodeSummary {
  episodeNumber: number;
  name: string;
  overview: string;
  stillUrl?: string;
  airDate?: string;
  runtimeMinutes?: number;
}
