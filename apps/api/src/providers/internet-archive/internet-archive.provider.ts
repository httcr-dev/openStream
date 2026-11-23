import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaRef, PlaybackProvider, PlaybackSource } from '../provider.types.js';
import { TtlCache } from '../ttl-cache.js';

interface ArchiveDocument {
  identifier: string;
  title: string;
  year?: string | number;
}

interface ArchiveFile {
  name?: string;
  format?: string;
  size?: string;
}

interface ArchiveMetadata {
  metadata?: { licenseurl?: string };
  files?: ArchiveFile[];
}

function normalizeTitle(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isPlayableVideo(file: ArchiveFile): boolean {
  const name = file.name?.toLowerCase() ?? '';
  return /\.(mp4|m4v|webm|mov|mkv)$/i.test(name);
}

function readCreativeCommonsLicense(value: string | undefined): { status: 'public-domain' | 'creative-commons'; licenseUrl: string } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'creativecommons.org' || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/+$/, '');
    if (/^\/publicdomain\/(?:mark|zero)\/1\.0$/.test(path)) {
      return { status: 'public-domain', licenseUrl: url.toString() };
    }
    if (/^\/licenses\/(?:by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/\d(?:\.\d)?$/.test(path)) {
      return { status: 'creative-commons', licenseUrl: url.toString() };
    }
    return null;
  } catch {
    return null;
  }
}

function archiveDownloadUrl(identifier: string, filename: string): string {
  const encodedPath = filename.split('/').map((part) => encodeURIComponent(part)).join('/');
  return \`https://archive.org/download/\${encodeURIComponent(identifier)}/\${encodedPath}\`;
}

@Injectable()
export class InternetArchiveProvider implements PlaybackProvider {
  readonly id = 'internet-archive';
  readonly name = 'Internet Archive';
  readonly playerKind = 'native' as const;
  readonly note = 'Busca vídeos com título exato e licença Creative Commons ou domínio público identificada nos metadados.';
  private readonly cache = new TtlCache<PlaybackSource[]>(60 * 60 * 1000);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return (this.config.get<string>('INTERNET_ARCHIVE_ENABLED') ?? 'true') !== 'false';
  }

  async findSources(ref: MediaRef): Promise<PlaybackSource[]> {
    if (ref.kind !== 'movie') return [];
    const titles = [...new Set([ref.title, ref.originalTitle].filter((value): value is string => Boolean(value)))];
    const key = \`\${titles.map(normalizeTitle).join('|')}|\${ref.year ?? ''}\`;
    return this.cache.getOrSet(key, () => this.search(titles, ref));
  }

  private async search(titles: string[], ref: MediaRef): Promise<PlaybackSource[]> {
    const safe = (value: string) => value.replace(/["\\]/g, ' ').trim();
    const titleQuery = titles.map((title) => \`title:"\${safe(title)}"\`).join(' OR ');
    const params = new URLSearchParams({
      q: \`(\${titleQuery}) AND mediatype:movies\`,
      rows: '50',
      output: 'json',
      sort: 'downloads desc',
    });
    for (const field of ['identifier', 'title', 'year']) params.append('fl[]', field);

    const response = await fetch(\`https://archive.org/advancedsearch.php?\${params}\`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(\`Internet Archive respondeu \${response.status}\`);
    const data = await response.json() as { response?: { docs?: ArchiveDocument[] } };
    const acceptedTitles = new Set(titles.map(normalizeTitle));
    const candidates = (data.response?.docs ?? []).filter((doc) => {
      if (!doc.identifier || !doc.title || !acceptedTitles.has(normalizeTitle(doc.title))) return false;
      if (ref.year && doc.year && Number(doc.year) !== ref.year) return false;
      return true;
    });

    const results = await Promise.allSettled(candidates.map(async (doc): Promise<PlaybackSource | null> => {
      const metadataResponse = await fetch(\`https://archive.org/metadata/\${encodeURIComponent(doc.identifier)}\`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!metadataResponse.ok) return null;
      const metadata = await metadataResponse.json() as ArchiveMetadata;
      const authorization = readCreativeCommonsLicense(metadata.metadata?.licenseurl);
      if (!authorization) return null;
      const file = (metadata.files ?? [])
        .filter(isPlayableVideo)
        .sort((a, b) => Number(/\.mp4$/i.test(b.name ?? '')) - Number(/\.mp4$/i.test(a.name ?? '')))[0];
      if (!file?.name) return null;

      return {
        id: \`internet-archive:\${doc.identifier}:\${file.name}\`,
        provider: this.name,
        providerId: this.id,
        label: \`\${doc.title}\${doc.year ? \` (\${doc.year})\` : ''} · \${file.format ?? file.name.split('.').pop()?.toUpperCase() ?? 'Vídeo'}\`,
        target: { kind: 'native', transport: 'http', url: archiveDownloadUrl(doc.identifier, file.name) },
        authorization,
      };
    }));

    return results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
  }
}
