import type { PlaybackSource, ReleaseMetadata } from './provider.types.js';

function qualityScore(quality?: string): number {
  const value = Number.parseInt(quality ?? '', 10);
  return Number.isFinite(value) ? value : 0;
}

function sourceKindScore(source: PlaybackSource): number {
  if (source.target.kind === 'native') return 3;
  if (source.target.kind === 'torrent') return 2;
  return 1;
}

function releaseTypeScore(type?: ReleaseMetadata['releaseType']): number {
  switch (type) {
    case 'WEB-DL':
    case 'BluRay': return 3;
    case 'WEBRip': return 2;
    case 'HDTV': return 1;
    default: return 0;
  }
}

function subtitleScore(release?: ReleaseMetadata): number {
  return release?.subtitles.some((language) => language.toUpperCase() === 'PT-BR') ? 1 : 0;
}

function codecScore(codec?: string): number {
  if (!codec) return 0;
  if (codec === 'HEVC' || codec === 'AV1') return 2;
  if (codec === 'AVC') return 1;
  return 0;
}

function compareSources(a: PlaybackSource, b: PlaybackSource, preferredProviderId?: string): number {
  const score = (source: PlaybackSource) => [
    source.availability?.status === 'available' ? 1 : 0,
    preferredProviderId && source.providerId === preferredProviderId ? 1 : 0,
    sourceKindScore(source),
    qualityScore(source.release?.quality ?? source.quality),
    releaseTypeScore(source.release?.releaseType),
    subtitleScore(source.release),
    codecScore(source.release?.codec),
    source.release?.seeders ?? -1,
  ];
  const left = score(a);
  const right = score(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return a.id.localeCompare(b.id);
}

function normalizeTitle(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function releaseKey(source: PlaybackSource): string {
  const release = source.release;
  const hasTechnicalFingerprint = Boolean(release?.quality || release?.releaseType || release?.codec ||
    release?.audio || release?.subtitles?.length || release?.sizeBytes);
  if (release?.title?.trim() && hasTechnicalFingerprint) {
    return [
      'release',
      normalizeTitle(release.title),
      release.year ?? '',
      release.season ?? '',
      release.episode ?? '',
      release.quality ?? '',
      release.releaseType ?? '',
      release.codec ?? '',
      release.audio ?? '',
      release.sizeBytes ?? '',
      [...(release.subtitles ?? [])].map((value) => value.toUpperCase()).sort().join(','),
    ].join('|');
  }

  const target = source.target;
  return target.kind === 'native'
    ? `native|${target.transport}|${target.url}`
    : target.kind === 'embed'
      ? `embed|${target.provider}|${target.embedUrl}`
      : `torrent|${target.infoHash.toLowerCase()}|${target.fileIdx ?? ''}`;
}

/** Remove fontes comprovadamente indisponíveis, agrupa releases equivalentes e ordena as melhores primeiro. */
export function rankPlaybackSources(
  sources: PlaybackSource[],
  preferredProviderId?: string,
): PlaybackSource[] {
  const candidates = sources.filter((source) => source.availability?.status !== 'unavailable');
  const bestByRelease = new Map<string, PlaybackSource>();

  for (const source of candidates) {
    const key = releaseKey(source);
    const current = bestByRelease.get(key);
    if (!current || compareSources(source, current, preferredProviderId) < 0) {
      bestByRelease.set(key, source);
    }
  }

  return [...bestByRelease.values()].sort((a, b) => compareSources(a, b, preferredProviderId));
}
