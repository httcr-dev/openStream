import { Injectable, Logger } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { ProviderRegistry } from './provider.registry.js';
import type { MediaRef, PlaybackSource } from './provider.types.js';

export interface ResolveResult {
  media: MediaRef;
  sources: PlaybackSource[];
  /** Providers que falharam (a resposta segue com as demais fontes) */
  errors: { provider: string; message: string }[];
}

@Injectable()
export class PlaybackSourceResolverService {
  private readonly logger = new Logger(PlaybackSourceResolverService.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly registry: ProviderRegistry,
  ) {}

  async resolve(id: string, season?: number, episode?: number): Promise<ResolveResult> {
    const { kind, tmdbId } = CatalogService.parseId(id);
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
      providers.map((p) => this.withTimeout(p.findSources(media), 10_000)),
    );

    const sources: PlaybackSource[] = [];
    const errors: ResolveResult['errors'] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        sources.push(...r.value);
      } else {
        const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
        this.logger.warn(`Provider ${providers[i].id} falhou: ${message}`);
        errors.push({ provider: providers[i].id, message });
      }
    });

    // Fontes nativas primeiro (melhor controle de reprodução)
    sources.sort((a, b) => Number(b.target.kind === 'native') - Number(a.target.kind === 'native'));
    return { media, sources, errors };
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout de ${ms}ms`)), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }
}
