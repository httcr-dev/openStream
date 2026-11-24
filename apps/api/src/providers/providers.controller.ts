import { Body, Controller, Get, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PlaybackSourceResolverService } from './playback-source-resolver.service.js';
import { PlaybackRuntimeService, type PlaybackFailoverInput } from './playback-runtime.service.js';
import { ProviderRegistry } from './provider.registry.js';
import { AddonRegistryService } from './stremio-addons/addon-registry.service.js';

@Controller()
export class ProvidersController {
  constructor(
    private readonly resolver: PlaybackSourceResolverService,
    private readonly runtime: PlaybackRuntimeService,
    private readonly registry: ProviderRegistry,
    private readonly addons: AddonRegistryService,
  ) {}

  @Get('providers')
  providers() {
    return this.registry.describe();
  }

  @Get('addons')
  addonsList() {
    return this.addons.list().map(({ manifestUrl, manifest, status, error }) => ({
      manifestUrl,
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      types: manifest.types ?? [],
      resources: manifest.resources,
      status,
      error,
      health: this.addons.getHealth(manifest.id),
    }));
  }

  /** GET /playback/sources?id=tmdb:series:123&season=1&episode=2 */
  @Get('playback/sources')
  sources(
    @Query('id') id: string,
    @Query('season', new ParseIntPipe({ optional: true })) season?: number,
    @Query('episode', new ParseIntPipe({ optional: true })) episode?: number,
    @Query('provider') provider?: string,
  ) {
    return this.resolver.resolve(id, season, episode, provider);
  }

  /** Reporta falha da fonte atual e devolve a próxima alternativa ainda não tentada. */
  @Post('playback/failover')
  failover(@Body() input: PlaybackFailoverInput) {
    return this.runtime.failover(input);
  }

  @Get('playback/runtime/stats')
  runtimeStats() {
    return this.runtime.getStats();
  }
}
