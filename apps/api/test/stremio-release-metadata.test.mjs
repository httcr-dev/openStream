import test from 'node:test';
import assert from 'node:assert/strict';
import { StremioAddonProvider } from '../dist/providers/stremio-addons/stremio-addon.provider.js';

test('StremioAddonProvider anexa metadados normalizados ao stream e ao torrent', async () => {
  const addon = {
    manifestUrl: 'https://addon.example/manifest.json',
    baseUrl: 'https://addon.example',
    manifest: { id: 'addon.example', version: '1.0.0', name: 'Example', resources: ['stream'], types: ['movie'], idPrefixes: ['tt'] },
    status: 'ready',
  };
  const registry = {
    waitUntilReady: async () => {},
    enabled: () => [addon],
    recordRequest() {},
    getHealth: () => ({ score: 1 }),
  };
  const provider = new StremioAddonProvider(registry);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ streams: [
    { title: 'Example.Movie.2024.1080p.WEB-DL.HEVC.PT-BR.2GB', url: 'https://cdn.example/movie.m3u8' },
    { title: 'Example.Movie.2024.1080p.WEB-DL.HEVC.PT-BR.2GB.190 seeders',
      infoHash: 'abcdef0123456789abcdef0123456789abcdef01', fileIdx: 3 },
  ] }), { status: 200 });
  try {
    const sources = await provider.findSources({
      id: 'tmdb:movie:42', kind: 'movie', tmdbId: 42, title: 'Example Movie', imdbId: 'tt1234567',
    });
    assert.equal(sources.length, 2);
    assert.equal(sources[0].release.year, 2024);
    assert.equal(sources[0].release.quality, '1080p');
    assert.equal(sources[0].release.codec, 'HEVC');
    assert.deepEqual(sources[0].release.subtitles, ['PT-BR']);
    assert.equal(sources[1].release.seeders, 190);
    assert.equal(sources[1].target.kind, 'torrent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
