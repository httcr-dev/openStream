import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry } from '../dist/providers/provider.registry.js';
import { TtlCache } from '../dist/providers/ttl-cache.js';
import { stremioContentId } from '../dist/providers/stremio-addons/stremio-addon.provider.js';
import { normalizeBaseUrl } from '../dist/providers/stremio-addons/addon-registry.service.js';
import { PlaybackSourceResolverService } from '../dist/providers/playback-source-resolver.service.js';

const movie = {
  id: 'tmdb:movie:10', kind: 'movie', tmdbId: 10, title: 'Example', imdbId: 'tt1234567',
};

test('ProviderRegistry registra e lista apenas providers habilitados', () => {
  const registry = new ProviderRegistry();
  registry.register({ id: 'on', name: 'On', playerKind: 'native', isEnabled: () => true });
  registry.register({ id: 'off', name: 'Off', playerKind: 'native', isEnabled: () => false });
  assert.deepEqual(registry.enabled().map((provider) => provider.id), ['on']);
  assert.equal(registry.describe().length, 2);
});

test('Stremio gera ID IMDb com temporada e episódio reais', () => {
  assert.equal(stremioContentId({ ...movie, kind: 'series', season: 2, episode: 7 }), 'tt1234567:2:7');
  assert.equal(stremioContentId({ ...movie, imdbId: undefined }), null);
  assert.equal(stremioContentId({ ...movie, kind: 'series', season: 1 }), null);
});

test('normaliza URL do manifest para base do addon', () => {
  assert.equal(normalizeBaseUrl('https://addon.example/path/manifest.json'), 'https://addon.example/path');
  assert.equal(normalizeBaseUrl('https://addon.example/manifest.json'), 'https://addon.example');
  assert.equal(normalizeBaseUrl('https://addon.example/manifest.json?token=abc'), 'https://addon.example/?token=abc');
});

test('TtlCache compartilha uma única chamada concorrente', async () => {
  const cache = new TtlCache(60_000);
  let calls = 0;
  const loader = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return ['ok']; };
  const [a, b] = await Promise.all([cache.getOrSet('k', loader), cache.getOrSet('k', loader)]);
  assert.deepEqual(a, ['ok']);
  assert.deepEqual(b, ['ok']);
  assert.equal(calls, 1);
});

test('resolver exige temporada e episódio para séries', async () => {
  const registry = new ProviderRegistry();
  const catalog = { detail: async () => ({ title: 'Example', originalTitle: 'Example', imdbId: 'tt1234567' }) };
  const resolver = new PlaybackSourceResolverService(catalog, registry);
  await assert.rejects(
    resolver.resolve('tmdb:series:10'),
    (error) => error.status === 400,
  );
});

test('resolver prioriza a origem anterior para continuidade', async () => {
  const registry = new ProviderRegistry();
  const source = (id, providerId) => ({ id, provider: providerId, providerId, label: id, target: { kind: 'native', transport: 'http', url: `https://${id}.example/video.mp4` } });
  registry.register({ id: 'addon-a', name: 'A', playerKind: 'native', isEnabled: () => true, findSources: async () => [source('a', 'addon-a')] });
  registry.register({ id: 'addon-b', name: 'B', playerKind: 'native', isEnabled: () => true, findSources: async () => [source('b', 'addon-b')] });
  const catalog = { detail: async () => ({ title: 'Example', originalTitle: 'Example', imdbId: 'tt1234567' }) };
  const resolver = new PlaybackSourceResolverService(catalog, registry);
  const result = await resolver.resolve('tmdb:series:10', 1, 2, 'addon-b');
  assert.equal(result.sources[0].providerId, 'addon-b');
});

test('StremioAddonProvider consulta exatamente o episódio solicitado', async () => {
  const addon = {
    manifestUrl: 'https://addon.example/manifest.json',
    baseUrl: 'https://addon.example',
    manifest: { id: 'addon.example', version: '1.0.0', name: 'Example Addon', resources: ['stream'], types: ['series'], idPrefixes: ['tt'] },
    status: 'ready',
  };
  const health = [];
  const registry = {
    enabled: () => [addon],
    recordRequest: (...args) => health.push(args),
    getHealth: () => ({ score: 1 }),
  };
  const provider = new (await import('../dist/providers/stremio-addons/stremio-addon.provider.js')).StremioAddonProvider(registry);
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ streams: [{ name: '1080p', url: 'https://cdn.example/episode.m3u8' }] }), { status: 200 });
  };
  try {
    const sources = await provider.findSources({
      id: 'tmdb:series:20', kind: 'series', tmdbId: 20, title: 'Example Series',
      imdbId: 'tt7654321', season: 2, episode: 3,
    });
    assert.match(requestedUrl, /\/stream\/series\/tt7654321:2:3\.json$/);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].target.kind, 'native');
    assert.equal(sources[0].target.transport, 'hls');
    assert.equal(sources[0].providerId, 'addon.example');
    assert.equal(health[0][1], true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StremioAddonProvider preserva torrent como candidato de reprodução', async () => {
  const addon = {
    manifestUrl: 'https://addon.example/manifest.json', baseUrl: 'https://addon.example',
    manifest: { id: 'addon.example', version: '1.0.0', name: 'Example Addon', resources: ['stream'], types: ['movie'] }, status: 'ready',
  };
  const registry = { enabled: () => [addon], recordRequest() {}, getHealth: () => ({ score: 0 }) };
  const provider = new (await import('../dist/providers/stremio-addons/stremio-addon.provider.js')).StremioAddonProvider(registry);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ streams: [{ name: 'Torrent 1080p', infoHash: 'abcdef0123456789abcdef0123456789abcdef01', fileIdx: 2 }] }), { status: 200 });
  try {
    const sources = await provider.findSources(movie);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].target.kind, 'torrent');
    assert.equal(sources[0].target.infoHash, 'abcdef0123456789abcdef0123456789abcdef01');
    assert.equal(sources[0].target.fileIdx, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StremioAddonProvider mantém resultados válidos mesmo quando outro addon falha', async () => {
  const good = {
    manifestUrl: 'https://good.example/manifest.json', baseUrl: 'https://good.example',
    manifest: { id: 'good', version: '1.0.0', name: 'Good', resources: ['stream'] }, status: 'ready',
  };
  const bad = {
    manifestUrl: 'https://bad.example/manifest.json', baseUrl: 'https://bad.example',
    manifest: { id: 'bad', version: '1.0.0', name: 'Bad', resources: ['stream'] }, status: 'ready',
  };
  const registry = { enabled: () => [good, bad], recordRequest() {}, getHealth: () => ({ score: 0 }) };
  const provider = new (await import('../dist/providers/stremio-addons/stremio-addon.provider.js')).StremioAddonProvider(registry);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('bad.example')
    ? new Response('Forbidden', { status: 403 })
    : new Response(JSON.stringify({ streams: [{ name: 'Torrent', infoHash: 'abcdef0123456789abcdef0123456789abcdef01' }] }), { status: 200 });
  try {
    await assert.rejects(provider.findSources(movie), (error) => {
      assert.equal(error.failures.length, 1);
      assert.equal(error.failures[0].provider, 'Bad');
      assert.equal(error.sources.length, 1);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Internet Archive só retorna filme com título exato e arquivo de vídeo real', async () => {
  const { InternetArchiveProvider } = await import('../dist/providers/internet-archive/internet-archive.provider.js');
  const provider = new InternetArchiveProvider({ get: () => 'true' });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes('advancedsearch.php')) {
      return new Response(JSON.stringify({ response: { docs: [
        { identifier: 'wrong-match', title: 'Example Movie: Behind the Scenes', year: 2020 },
        { identifier: 'example-movie', title: 'Example Movie', year: 2020 },
      ] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ files: [
      { name: 'poster.jpg', format: 'JPEG' },
      { name: 'feature.mp4', format: 'MPEG4', size: '1000' },
    ] }), { status: 200 });
  };
  try {
    const sources = await provider.findSources({ ...movie, title: 'Example Movie', year: 2020 });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].target.kind, 'native');
    assert.equal(sources[0].target.url, 'https://archive.org/download/example-movie/feature.mp4');
    assert.equal(requests.filter((url) => url.includes('/metadata/')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Internet Archive não oferece itens de série como se fossem episódios', async () => {
  const { InternetArchiveProvider } = await import('../dist/providers/internet-archive/internet-archive.provider.js');
  const provider = new InternetArchiveProvider({ get: () => 'true' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Não deveria consultar'); };
  try {
    const sources = await provider.findSources({ ...movie, kind: 'series', season: 1, episode: 2 });
    assert.deepEqual(sources, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
