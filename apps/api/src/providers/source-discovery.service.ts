import { Injectable, Logger } from '@nestjs/common';
import { ProviderRegistry } from './provider.registry.js';
import { ProviderSearchError } from './provider.types.js';
import type { MediaRef, PlaybackSource, ProviderSearchFailure } from './provider.types.js';

export interface SourceDiscoveryResult {
  sources: PlaybackSource[];
  errors: ProviderSearchFailure[];
}

@Injectable()
export class SourceDiscoveryService {
  private readonly logger = new Logger(SourceDiscoveryService.name);

  constructor(private readonly registry: ProviderRegistry) {}

  async discover(ref: MediaRef, preferredProviderId?: string): Promise<SourceDiscoveryResult> {
    const providers = this.registry.enabled();
    const settled = await Promise.allSettled(
      providers.map((provider) => this.withTimeout(
        provider.findSources(ref),
        provider.id === 'stremio-addons' ? 60_000 : 10_000,
      )),
    );

    const sources: PlaybackSource[] = [];
    const errors: ProviderSearchFailure[] = [];

    settled.forEach((result, index) => {
      const provider = providers[index];
      if (result.status === 'fulfilled') {
        sources.push(...result.value);
        return;
      }

      const reason = result.reason;
      if (reason instanceof ProviderSearchError) {
        sources.push(...reason.sources);
        errors.push(...reason.failures);
        return;
      }

      const message = reason instanceof Error ? reason.message : String(reason);
      this.logger.warn(`Provider ${provider.id} falhou: ${message}`);
      errors.push({ provider: provider.id, message });
    });

    const validSources = sources.filter((source) => {
      const valid = this.isValidSource(source);
      if (!valid) {
        errors.push({
          provider: source.providerId ?? source.provider ?? 'unknown',
          message: `Fonte descartada por formato ou destino inválido: ${source.id || 'sem ID'}`,
        });
      }
      return valid;
    });

    validSources.sort((a, b) => {
      const preferredA = Number(Boolean(preferredProviderId && a.providerId === preferredProviderId));
      const preferredB = Number(Boolean(preferredProviderId && b.providerId === preferredProviderId));
      if (preferredA !== preferredB) return preferredB - preferredA;
      return Number(b.target.kind !== 'embed') - Number(a.target.kind !== 'embed');
    });

    return { sources: this.deduplicate(validSources), errors };
  }

  private isValidSource(source: PlaybackSource): boolean {
    if (!source || typeof source.id !== 'string' || !source.id.trim() ||
        typeof source.provider !== 'string' || !source.provider.trim() ||
        typeof source.label !== 'string' || !source.label.trim() || !source.target) return false;

    if (source.target.kind === 'native') {
      try {
        const url = new URL(source.target.url);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
          (source.target.transport === 'http' || source.target.transport === 'hls');
      } catch {
        return false;
      }
    }

    if (source.target.kind === 'embed') {
      try {
        const url = new URL(source.target.embedUrl);
        return url.protocol === 'https:' && !url.username && !url.password &&
          typeof source.target.provider === 'string' && source.target.provider.length > 0;
      } catch {
        return false;
      }
    }

    if (source.target.kind === 'torrent') {
      return /^(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(source.target.infoHash) &&
        (source.target.fileIdx === undefined ||
          (Number.isInteger(source.target.fileIdx) && source.target.fileIdx >= 0));
    }

    return false;
  }

  private deduplicate(sources: PlaybackSource[]): PlaybackSource[] {
    const seen = new Set<string>();
    return sources.filter((source) => {
      const target = source.target;
      const key = target.kind === 'native'
        ? `native:${target.transport}:${target.url}`
        : target.kind === 'embed'
          ? `embed:${target.provider}:${target.embedUrl}`
          : `torrent:${target.infoHash.toLowerCase()}:${target.fileIdx ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
