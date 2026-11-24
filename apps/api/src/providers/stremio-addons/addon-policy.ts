import type { PlaybackSource } from '../provider.types.js';
import type { StremioManifest, StremioResource } from './addon.types.js';

function hasResource(manifest: StremioManifest, name: string): boolean {
  return manifest.resources.some((resource: StremioResource) =>
    typeof resource === 'string' ? resource === name : resource.name === name,
  );
}

/** Strict manifest contract: no wildcard behavior for missing types or ID prefixes. */
export function isManifestEligible(
  manifest: StremioManifest,
  type: 'movie' | 'series',
  contentId: string,
): boolean {
  if (!manifest || !Array.isArray(manifest.resources) || !hasResource(manifest, 'stream')) return false;
  if (!manifest.types?.includes(type)) return false;
  if (!manifest.idPrefixes?.length || !manifest.idPrefixes.some((prefix) => contentId.startsWith(prefix))) return false;
  const resource = manifest.resources.find((item) =>
    typeof item === 'string' ? item === 'stream' : item.name === 'stream',
  );
  if (resource && typeof resource !== 'string') {
    if (!resource.types?.includes(type)) return false;
    if (!resource.idPrefixes?.length || !resource.idPrefixes.some((prefix) => contentId.startsWith(prefix))) return false;
  }
  return true;
}

export function isAddonAllowed(addonId: string, allowlist: string[]): boolean {
  return allowlist.includes(addonId);
}

export function cooldownForStatus(status: number): number {
  if (status === 403) return 15 * 60_000;
  if (status === 404 || status === 410) return 60 * 60_000;
  if (status === 429) return 10 * 60_000;
  if (status >= 500 || status === 0) return 2 * 60_000;
  return 0;
}

/** Unknown health is not evidence that a source can be played. */
export function isPlaybackCandidate(source: PlaybackSource): boolean {
  if (source.target.kind !== 'native' || source.availability?.status !== 'available') return false;
  const authorization = source.authorization;
  if (!authorization || !authorization.licenseUrl) return false;
  return ['public-domain', 'creative-commons', 'licensed', 'user-owned'].includes(authorization.status);
}
