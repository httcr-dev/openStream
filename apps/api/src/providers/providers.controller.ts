import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { PlaybackSourceResolverService } from './playback-source-resolver.service.js';
import { ProviderRegistry } from './provider.registry.js';
import { AddonRegistryService } from './stremio-addons/addon-registry.service.js';

@Controller()
export class ProvidersController {
  constructor(
    private readonly resolver: PlaybackSourceResolverService,
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
}
