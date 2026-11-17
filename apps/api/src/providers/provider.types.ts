import type { MediaKind } from '../catalog/catalog.types.js';

/** Identidade do conteúdo solicitado no catálogo. */
export interface MediaRef {
  id: string;
  kind: MediaKind;
  tmdbId: number;
  title: string;
  originalTitle?: string;
  year?: number;
  imdbId?: string;
  season?: number;
  episode?: number;
}

export type PlaybackTarget =
  | { kind: 'native'; transport: 'http' | 'hls'; url: string }
  | { kind: 'embed'; provider: string; embedUrl: string }
  | { kind: 'torrent'; infoHash: string; fileIdx?: number; externalUrl?: string };

export interface PlaybackSource {
  id: string;
  provider: string;
  label: string;
  quality?: string;
  target: PlaybackTarget;
  /** ID do addon/provider que encontrou a fonte, usado para continuidade. */
  providerId?: string;
}

export interface ProviderSearchFailure {
  provider: string;
  message: string;
}

/**
 * Um provider pode encontrar fontes válidas e, simultaneamente, falhar em
 * outros addons. Mantemos ambos para não perder resultados parciais.
 */
export class ProviderSearchError extends Error {
  constructor(
    message: string,
    public readonly sources: PlaybackSource[],
    public readonly failures: ProviderSearchFailure[],
  ) {
    super(message);
    this.name = 'ProviderSearchError';
  }
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  enabled: boolean;
  playerKind: 'native' | 'embed';
  note?: string;
}

export interface PlaybackProvider {
  readonly id: string;
  readonly name: string;
  readonly playerKind: 'native' | 'embed';
  readonly note?: string;
  isEnabled(): boolean;
  findSources(ref: MediaRef): Promise<PlaybackSource[]>;
}
