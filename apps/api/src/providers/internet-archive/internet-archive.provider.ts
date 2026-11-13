import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaRef, PlaybackProvider, PlaybackSource } from '../provider.types.js';
import { TtlCache } from '../ttl-cache.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class InternetArchiveProvider implements PlaybackProvider {
  readonly id = 'internet-archive';
  readonly name = 'Internet Archive';
  readonly playerKind = 'embed' as const;
  readonly note =
    'Player oficial do archive.org. Acervo majoritariamente de domínio público ou licenciado para circulação.';

  private readonly cache = new TtlCache<PlaybackSource[]>(6 * 60 * 60 * 1000);

  constructor(private readonly config: ConfigService) {}

  isEnabled() {
    return (this.config.get<string>('INTERNET_ARCHIVE_ENABLED') ?? 'true') !== 'false';
  }

  async findSources(ref: MediaRef): Promise<PlaybackSource[]> {
    const titles = [...new Set([ref.title, ref.originalTitle].filter((t): t is string => !!t))];
    const key = `${titles.join('|')}|${ref.year ?? ''}`;
    return this.cache.getOrSet(key, () => this.search(titles, ref));
  }

  private async search(titles: string[], ref: MediaRef): Promise<PlaybackSource[]> {
    const clean = (t: string) => t.replace(/["\\]/g, ' ').trim();
    const titleQuery = titles.map((t) => `title:"${clean(t)}"`).join(' OR ');
    const params = new URLSearchParams({
      q: `(${titleQuery}) AND mediatype:movies`,
      rows: '5',
      output: 'json',
      sort: 'downloads desc',
    });
    for (const f of ['identifier', 'title', 'year']) params.append('fl[]', f);

    const res = await fetch(`https://archive.org/advancedsearch.php?${params}`);
    if (!res.ok) throw new Error(`Internet Archive respondeu ${res.status}`);
    const data = (await res.json()) as { response?: { docs?: any[] } };

    const docs = data.response?.docs ?? [];
    // Prioriza o ano correto, quando houver
    docs.sort(
      (a, b) =>
        Number(String(b.year) === String(ref.year)) - Number(String(a.year) === String(ref.year)),
    );

    return docs.map((d) => ({
      id: `internet-archive:${d.identifier}`,
      provider: this.id,
      label: `${d.title}${d.year ? ` (${d.year})` : ''}`,
      target: {
        kind: 'embed' as const,
        provider: this.id,
        embedUrl: `https://archive.org/embed/${encodeURIComponent(d.identifier)}`,
      },
    }));
  }
}
