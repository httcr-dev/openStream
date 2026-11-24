import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlaybackSourceResolverService } from './playback-source-resolver.service.js';
import type { PlaybackSource } from './provider.types.js';

export interface PlaybackFailoverInput {
  id: string;
  season?: number;
  episode?: number;
  provider?: string;
  failedSourceIds: string[];
  failedSourceId: string;
  reason: string;
}

type FailureMetric = {
  sourceId: string;
  provider: string;
  failures: number;
  lastReason: string;
  lastFailedAt: string;
};

const METRIC_TTL_MS = 60 * 60_000;
const MAX_METRICS = 500;
const MAX_FAILED_IDS = 50;

@Injectable()
export class PlaybackRuntimeService {
  private readonly logger = new Logger(PlaybackRuntimeService.name);
  private readonly failures = new Map<string, FailureMetric>();
  private totalFailures = 0;
  private successfulFailovers = 0;
  private exhaustedFailovers = 0;

  constructor(private readonly resolver: PlaybackSourceResolverService) {}

  async failover(input: PlaybackFailoverInput) {
    if (!input || typeof input.id !== 'string' || !input.id.trim() ||
        typeof input.failedSourceId !== 'string' || !input.failedSourceId.trim() ||
        !Array.isArray(input.failedSourceIds) || input.failedSourceIds.length > MAX_FAILED_IDS ||
        input.failedSourceIds.some((id) => typeof id !== 'string' || !id.trim()) ||
        typeof input.reason !== 'string' || !input.reason.trim()) {
      throw new BadRequestException('Dados inválidos para solicitar failover.');
    }

    const failedIds = [...new Set([...input.failedSourceIds, input.failedSourceId])];
    this.recordFailure(input.failedSourceId, input.reason);

    const result = await this.resolver.resolve(
      input.id,
      input.season,
      input.episode,
      input.provider,
    );
    const sources = result.sources.filter((source) =>
      !failedIds.includes(source.id) && source.availability?.status !== 'unavailable',
    );
    const nextSource = sources[0] ?? null;

    if (nextSource) {
      this.successfulFailovers += 1;
      this.logger.warn(`Playback failover: ${input.failedSourceId} -> ${nextSource.id} (${input.reason.slice(0, 160)})`);
    } else {
      this.exhaustedFailovers += 1;
      this.logger.warn(`Playback sources exhausted after ${input.failedSourceId}: ${input.reason.slice(0, 160)}`);
    }

    return {
      media: result.media,
      nextSource,
      sources,
      exhausted: nextSource === null,
    };
  }

  getStats() {
    this.pruneMetrics();
    return {
      totalFailures: this.totalFailures,
      successfulFailovers: this.successfulFailovers,
      exhaustedFailovers: this.exhaustedFailovers,
      trackedSources: this.failures.size,
      sources: [...this.failures.values()].sort((a, b) => b.failures - a.failures),
    };
  }

  private recordFailure(sourceId: string, reason: string) {
    this.pruneMetrics();
    const existing = this.failures.get(sourceId);
    const metric: FailureMetric = {
      sourceId,
      provider: sourceId.split(':', 1)[0] || 'unknown',
      failures: (existing?.failures ?? 0) + 1,
      lastReason: reason.slice(0, 500),
      lastFailedAt: new Date().toISOString(),
    };
    this.failures.delete(sourceId);
    this.failures.set(sourceId, metric);
    this.totalFailures += 1;
    while (this.failures.size > MAX_METRICS) {
      const oldest = this.failures.keys().next().value;
      if (!oldest) break;
      this.failures.delete(oldest);
    }
  }

  private pruneMetrics() {
    const cutoff = Date.now() - METRIC_TTL_MS;
    for (const [sourceId, metric] of this.failures) {
      if (Date.parse(metric.lastFailedAt) < cutoff) this.failures.delete(sourceId);
    }
  }
}
