import { Injectable } from '@nestjs/common';
import type { PlaybackProvider, ProviderDescriptor } from './provider.types.js';

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, PlaybackProvider>();

  register(provider: PlaybackProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string) {
    return this.providers.get(id);
  }

  enabled(): PlaybackProvider[] {
    return [...this.providers.values()].filter((p) => p.isEnabled());
  }

  describe(): ProviderDescriptor[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      enabled: p.isEnabled(),
      playerKind: p.playerKind,
      note: p.note,
    }));
  }
}
