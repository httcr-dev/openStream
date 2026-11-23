import { BadRequestException, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { SourceDiscoveryService } from './source-discovery.service.js';
import type { MediaRef } from './provider.types.js';

export interface ResolveResult {
  media: MediaRef;
  sources: import('./provider.types.js').PlaybackSource[];
  errors: { provider: string; message: string }[];
}

@Injectable()
export class PlaybackSourceResolverService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly discovery: SourceDiscoveryService,
  ) {}

  async resolve(
    id: string,
    season?: number,
    episode?: number,
    preferredProviderId?: string,
  ): Promise<ResolveResult> {
    const { kind, tmdbId } = CatalogService.parseId(id);
    if (kind === 'series' && (!Number.isInteger(season) || !Number.isInteger(episode) || season! < 0 || episode! < 1)) {
      throw new BadRequestException('Para buscar uma série, informe temporada e episódio válidos.');
    }
    if (kind === 'movie' && (season !== undefined || episode !== undefined)) {
      throw new BadRequestException('Filmes não possuem temporada ou episódio.');
    }

    const detail = await this.catalog.detail(kind, tmdbId);
    const media: MediaRef = {
      id, kind, tmdbId, title: detail.title,
      originalTitle: detail.originalTitle || undefined,
      year: detail.year, imdbId: detail.imdbId, season, episode,
    };

    const result = await this.discovery.discover(media, preferredProviderId);
    return { media, ...result };
  }
}
