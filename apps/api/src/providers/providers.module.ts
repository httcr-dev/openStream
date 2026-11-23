import { Module, type OnModuleInit } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InternetArchiveProvider } from './internet-archive/internet-archive.provider.js';
import { PlaybackSourceResolverService } from './playback-source-resolver.service.js';
import { ProviderRegistry } from './provider.registry.js';
import { SourceDiscoveryService } from './source-discovery.service.js';
import { ProvidersController } from './providers.controller.js';
import { AddonRegistryService } from './stremio-addons/addon-registry.service.js';
import { StremioAddonProvider } from './stremio-addons/stremio-addon.provider.js';
import { TorrentPlaybackController } from './torrent-playback.controller.js';
import { TorrentPlaybackService } from './torrent-playback.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [ProvidersController, TorrentPlaybackController],
  providers: [
    ProviderRegistry,
    PlaybackSourceResolverService,
    SourceDiscoveryService,
    AddonRegistryService,
    StremioAddonProvider,
    InternetArchiveProvider,
    TorrentPlaybackService,
  ],
})
export class ProvidersModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly addons: StremioAddonProvider,
    private readonly archive: InternetArchiveProvider,
  ) {}

  onModuleInit() {
    this.registry.register(this.addons);
    this.registry.register(this.archive);
  }
}
