import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPlaybackSources } from '../dist/providers/source-ranking.js';

const source = (id, release, target = { kind: 'native', transport: 'http', url: `https://${id}.example/video.mp4` }, availability = 'available') => ({
  id, provider: id, providerId: id, label: id, target, release,
  availability: { status: availability, checkedAt: new Date().toISOString() },
});

test('ranking prioriza disponibilidade, fonte direta, qualidade e idioma PT-BR', () => {
  const ranked = rankPlaybackSources([
    source('p2p-4k', { title: 'Show', quality: '2160p', seeders: 900, subtitles: ['EN'] },
      { kind: 'torrent', infoHash: 'a'.repeat(40) }, 'unknown'),
    source('direct-1080', { title: 'Show', quality: '1080p', releaseType: 'WEB-DL', seeders: 20, subtitles: ['PT-BR'] }),
    source('unavailable', { title: 'Show', quality: '2160p', subtitles: ['PT-BR'] },
      { kind: 'native', transport: 'http', url: 'https://bad.example/file.mp4' }, 'unavailable'),
    source('direct-1080-en', { title: 'Show', quality: '1080p', releaseType: 'WEB-DL', seeders: 200, subtitles: ['EN'] }),
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ['direct-1080', 'direct-1080-en', 'p2p-4k']);
});

test('deduplica releases equivalentes de addons diferentes mantendo a melhor fonte', () => {
  const ranked = rankPlaybackSources([
    source('addon-a', { title: 'Example Show', year: 2024, season: 2, episode: 3, quality: '1080p', codec: 'HEVC', subtitles: ['EN'] },
      { kind: 'torrent', infoHash: 'b'.repeat(40) }, 'unknown'),
    source('addon-b', { title: 'example.show', year: 2024, season: 2, episode: 3, quality: '1080p', codec: 'HEVC', subtitles: ['EN'] }),
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'addon-b');
});

test('não agrupa releases com qualidade, codec ou episódio diferentes', () => {
  const ranked = rankPlaybackSources([
    source('one', { title: 'Show', year: 2024, season: 1, episode: 1, quality: '1080p', codec: 'HEVC', subtitles: [] }),
    source('two', { title: 'Show', year: 2024, season: 1, episode: 1, quality: '2160p', codec: 'HEVC', subtitles: [] }),
    source('three', { title: 'Show', year: 2024, season: 1, episode: 2, quality: '1080p', codec: 'HEVC', subtitles: [] }),
  ]);
  assert.equal(ranked.length, 3);
});
