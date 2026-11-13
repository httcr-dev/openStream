import { Module, type OnModuleInit } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InternetArchiveProvider } from './internet-archive/internet-archive.provider.js';
import { JellyfinClient } from './jellyfin/jellyfin.client.js';
import { JellyfinProvider } from './jellyfin/jellyfin.provider.js';
import { JellyfinStreamController } from './jellyfin/jellyfin-stream.controller.js';
import { PeerTubeProvider } from './peertube/peertube.provider.js';
import { PlaybackSourceResolverService } from './playback-source-resolver.service.js';
import { ProviderRegistry } from './provider.registry.js';
import { ProvidersController } from './providers.controller.js';
import { YouTubeProvider } from './youtube/youtube.provider.js';

@Module({
  imports: [CatalogModule],
  controllers: [ProvidersController, JellyfinStreamController],
  providers: [
    ProviderRegistry,
    PlaybackSourceResolverService,
    JellyfinClient,
    JellyfinProvider,
    YouTubeProvider,
    PeerTubeProvider,
    InternetArchiveProvider,
  ],
})
export class ProvidersModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly jellyfin: JellyfinProvider,
    private readonly youtube: YouTubeProvider,
    private readonly peertube: PeerTubeProvider,
    private readonly archive: InternetArchiveProvider,
  ) {}

  /** Para adicionar um provider: implemente PlaybackProvider e registre aqui. */
  onModuleInit() {
    for (const p of [this.jellyfin, this.youtube, this.peertube, this.archive]) {
      this.registry.register(p);
    }
  }
}
