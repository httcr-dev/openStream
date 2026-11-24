import type { ReleaseMetadata } from './provider.types.js';

export interface ReleaseInput {
  title?: string;
  description?: string;
  size?: string | number;
  seeders?: number;
}

const QUALITY = ['2160p', '1440p', '1080p', '720p', '576p', '480p'] as const;
const LANGUAGES = ['PT-BR', 'PT-PT', 'PT', 'EN', 'ES', 'FR', 'JA', 'KO', 'ZH', 'DE', 'IT', 'RU'] as const;

function parseSize(value: string | number | undefined, text: string): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  const match = /(\d+(?:[.,]\d+)?)\s*(TiB|TB|GiB|GB|MiB|MB)\b/i.exec(text);
  if (!match) return undefined;
  const amount = Number(match[1].replace(',', '.'));
  const unit = match[2].toUpperCase();
  const factor = unit === 'TB' || unit === 'TIB' ? 1024 ** 4
    : unit === 'GB' || unit === 'GIB' ? 1024 ** 3
      : 1024 ** 2;
  return Math.round(amount * factor);
}

function parseSeeders(value: number | undefined, text: string): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  const match = /([\d.,]+)\s*(?:seeders?|peers?)\b/i.exec(text);
  if (!match) return undefined;
  const parsed = Number(match[1].replace(/[.,]/g, ''));
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function cleanTitle(value: string, text: string): string {
  let title = value;
  title = title.replace(/\bS\d{1,2}E\d{1,3}\b/ig, ' ');
  title = title.replace(/\b\d{1,2}x\d{1,3}\b/ig, ' ');
  title = title.replace(/\b(?:19|20)\d{2}\b/g, ' ');
  title = title.replace(/\b(?:2160p|1440p|1080p|720p|576p|480p|4k|uhd|fhd|hd)\b/ig, ' ');
  title = title.replace(/\b(?:web[ ._-]?dl|web[ ._-]?rip|blu[ ._-]?ray|brrip|bdrip|hdtv|dvdrip)\b/ig, ' ');
  title = title.replace(/\b(?:x26[45]|h\.?26[45]|hevc|avc|av1|xvid|vp9|aac|dts|eac3|ac3|truehd|atmos|dual(?:[ ._-]?audio)?)\b/ig, ' ');
  title = title.replace(/\b(?:pt[ ._-]?br|pt[ ._-]?pt|multi(?:[ ._-]?subs?)?|\d+(?:[.,]\d+)?\s*(?:gb|gib|mb|mib|tb|tib)|[\d.,]+\s*(?:seeders?|peers?))\b/ig, ' ');
  title = title.replace(/[._]+/g, ' ').replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  return title || value.trim() || text.trim();
}

export function normalizeReleaseMetadata(input: ReleaseInput): ReleaseMetadata {
  const rawTitle = input.title?.trim() ?? '';
  const description = input.description?.trim() ?? '';
  const text = `${rawTitle} ${description}`.trim();
  const quality = QUALITY.find((item) => new RegExp(`\\\\b${item}\\\\b`, 'i').test(text));
  const releaseType = /blu[ ._-]?ray|brrip|bdrip/i.test(text) ? 'BluRay'
    : /web[ ._-]?dl/i.test(text) ? 'WEB-DL'
      : /web[ ._-]?rip/i.test(text) ? 'WEBRip'
        : /hdtv/i.test(text) ? 'HDTV'
          : /dvdrip/i.test(text) ? 'DVDRip' : undefined;

  const codec = /\bAV1\b/i.test(text) ? 'AV1'
    : /\b(?:HEVC|H\.?265|X265)\b/i.test(text) ? 'HEVC'
      : /\b(?:AVC|H\.?264|X264)\b/i.test(text) ? 'AVC'
        : /\bMPEG[- ]?2\b/i.test(text) ? 'MPEG-2'
          : /\bVP9\b/i.test(text) ? 'VP9' : undefined;

  const audio = /\bdual(?:[ ._-]?audio)?\b/i.test(text) ? 'Dual Audio'
    : /\b(?:7\.1|5\.1|2\.0)\b/.exec(text)?.[0]
      ?? (/\bAtmos\b/i.test(text) ? 'Dolby Atmos'
        : /\bTrueHD\b/i.test(text) ? 'TrueHD'
          : /\bDTS(?:-HD)?\b/i.test(text) ? 'DTS'
            : /\bEAC3\b|\bDDP\b/i.test(text) ? 'E-AC-3'
              : /\bAAC\b/i.test(text) ? 'AAC' : undefined);

  const subtitles = LANGUAGES.filter((language) => {
    const pattern = language === 'PT-BR' ? /\bPT[ ._-]?BR\b/i
      : language === 'PT-PT' ? /\bPT[ ._-]?PT\b/i
        : new RegExp(`\\\\b${language}\\\\b`, 'i');
    return pattern.test(text);
  });

  const episodeMatch = /\bS(\d{1,2})E(\d{1,3})\b/i.exec(text)
    ?? /\b(\d{1,2})x(\d{1,3})\b/i.exec(text);
  const yearMatch = /\b((?:19|20)\d{2})\b/.exec(text);

  return {
    title: cleanTitle(rawTitle, text),
    ...(yearMatch ? { year: Number(yearMatch[1]) } : {}),
    ...(episodeMatch ? { season: Number(episodeMatch[1]), episode: Number(episodeMatch[2]) } : {}),
    ...(quality ? { quality } : {}),
    ...(releaseType ? { releaseType } : {}),
    ...(codec ? { codec } : {}),
    ...(audio ? { audio } : {}),
    subtitles,
    ...(parseSize(input.size, text) ? { sizeBytes: parseSize(input.size, text) } : {}),
    ...(parseSeeders(input.seeders, text) !== undefined ? { seeders: parseSeeders(input.seeders, text) } : {}),
  };
}
