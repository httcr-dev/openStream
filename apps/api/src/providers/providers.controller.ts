import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { PlaybackSourceResolverService } from './playback-source-resolver.service.js';
import { ProviderRegistry } from './provider.registry.js';

@Controller()
export class ProvidersController {
  constructor(
    private readonly resolver: PlaybackSourceResolverService,
    private readonly registry: ProviderRegistry,
  ) {}

  @Get('providers')
  providers() {
    return this.registry.describe();
  }

  /** GET /playback/sources?id=tmdb:movie:123[&season=1&episode=2] */
  @Get('playback/sources')
  sources(
    @Query('id') id: string,
    @Query('season', new ParseIntPipe({ optional: true })) season?: number,
    @Query('episode', new ParseIntPipe({ optional: true })) episode?: number,
  ) {
    return this.resolver.resolve(id, season, episode);
  }
}
