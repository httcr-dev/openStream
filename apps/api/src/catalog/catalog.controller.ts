import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('search')
  search(@Query('q') q = '') {
    return this.catalog.search(q);
  }

  @Get('movie/:tmdbId')
  movie(@Param('tmdbId', ParseIntPipe) tmdbId: number) {
    return this.catalog.detail('movie', tmdbId);
  }

  @Get('series/:tmdbId')
  series(@Param('tmdbId', ParseIntPipe) tmdbId: number) {
    return this.catalog.detail('series', tmdbId);
  }

  @Get('series/:tmdbId/seasons/:season')
  episodes(
    @Param('tmdbId', ParseIntPipe) tmdbId: number,
    @Param('season', ParseIntPipe) season: number,
  ) {
    return this.catalog.episodes(tmdbId, season);
  }
}
