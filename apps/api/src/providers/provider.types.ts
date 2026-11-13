import type { MediaKind } from '../catalog/catalog.types.js';

/** Referência do conteúdo que o usuário quer assistir. */
export interface MediaRef {
  id: string; // tmdb:movie:123 | tmdb:series:456
  kind: MediaKind;
  tmdbId: number;
  title: string;
  originalTitle?: string;
  year?: number;
  imdbId?: string;
  /** Apenas para séries */
  season?: number;
  episode?: number;
}

/**
 * Como o frontend deve reproduzir uma fonte.
 * - native: <video> próprio (HTTP Direct Play ou HLS via hls.js)
 * - embed:  player oficial do provedor dentro de um iframe
 */
export type PlaybackTarget =
  | {
      kind: 'native';
      transport: 'http' | 'hls';
      url: string;
    }
  | {
      kind: 'embed';
      provider: string;
      embedUrl: string;
    };

export interface PlaybackSource {
  /** Estável por fonte, ex.: `jellyfin:abc123`, `youtube:dQw4w9WgXcQ` */
  id: string;
  provider: string;
  label: string;
  quality?: string;
  target: PlaybackTarget;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  enabled: boolean;
  /** native = player próprio; embed = player oficial do provedor */
  playerKind: 'native' | 'embed';
  /** Observação exibida na UI/README (ex.: anúncios do próprio provedor) */
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
