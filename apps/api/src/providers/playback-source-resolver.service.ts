import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { ProviderRegistry } from './provider.registry.js';
import type { MediaRef, PlaybackSource } from './provider.types.js';

export interface ResolveResult {
  media: MediaRef;
  sources: PlaybackSource[];
  errors: { provider: string; message: string }[];
}

@Injectable()
export class PlaybackSourceResolverService {
  private readonly logger = new Logger(PlaybackSourceResolverService.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly registry: ProviderRegistry,
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
      id,
      kind,
      tmdbId,
      title: detail.title,
      originalTitle: detail.originalTitle || undefined,
      year: detail.year,
      imdbId: detail.imdbId,
      season,
      episode,
    };

    const providers = this.registry.enabled();
    const settled = await Promise.allSettled(
      providers.map((provider) => this.withTimeout(provider.findSources(media), 10_000)),
    );

    const sources: PlaybackSource[] = [];
    const errors: ResolveResult['errors'] = [];
    settled.forEach((result, index) => {
      const provider = providers[index];
      if (result.status === 'fulfilled') {
        sources.push(...result.value);
      } else {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.warn(`Provider ${provider.id} falhou: ${message}`);
        errors.push({ provider: provider.id, message });
      }
    });

    // Prioriza a mesma origem ao avançar de episódio; depois, player nativo.
    sources.sort((a, b) => {
      const preferredA = Number(Boolean(preferredProviderId && a.providerId === preferredProviderId));
      const preferredB = Number(Boolean(preferredProviderId && b.providerId === preferredProviderId));
      if (preferredA !== preferredB) return preferredB - preferredA;
      return Number(b.target.kind === 'native') - Number(a.target.kind === 'native');
    });
    return { media, sources, errors };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout de ${ms}ms`)), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }
}
