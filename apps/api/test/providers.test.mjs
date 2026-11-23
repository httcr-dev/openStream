import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry } from '../dist/providers/provider.registry.js';
import { TtlCache } from '../dist/providers/ttl-cache.js';
import { stremioContentId } from '../dist/providers/stremio-addons/stremio-addon.provider.js';
import { AddonRegistryService, collectManifestUrls, isSafeAddonUrl, normalizeBaseUrl } from '../dist/providers/stremio-addons/addon-registry.service.js';
import { PlaybackSourceResolverService } from '../dist/providers/playback-source-resolver.service.js';
import { SourceDiscoveryService } from '../dist/providers/source-discovery.service.js';
import { parseByteRange } from '../dist/providers/torrent-playback.service.js';

const movie = {
  id: 'tmdb:movie:10', kind: 'movie', tmdbId: 10, title: 'Example', imdbId: 'tt1234567',
};

test('parseByteRange aceita intervalos completos, abertos e sufixos', () => {
  assert.deepEqual(parseByteRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseByteRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.equal(parseByteRange(undefined, 1000), null);
});

test('parseByteRange rejeita ranges inválidos e múltiplos', () => {
  assert.equal(parseByteRange('bytes=1000-1100', 1000), false);
  assert.equal(parseByteRange('bytes=200-100', 1000), false);
  assert.equal(parseByteRange('bytes=0-10,20-30', 1000), false);
  assert.equal(parseByteRange('items=0-10', 1000), false);
});

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
  const resolver = new PlaybackSourceResolverService(catalog, new SourceDiscoveryService(registry));
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


test('SourceDiscovery deduplica destinos e descarta fontes malformadas', async () => {
  const registry = new ProviderRegistry();
  const source = (id, url) => ({
    id, provider: id, providerId: id, label: id,
    target: { kind: 'native', transport: 'http', url },
  });
  registry.register({
    id: 'provider-a', name: 'A', playerKind: 'native', isEnabled: () => true,
    findSources: async () => [
      source('first', 'https://cdn.example/video.mp4'),
      source('duplicate', 'https://cdn.example/video.mp4'),
      source('invalid', 'javascript:alert(1)'),
    ],
  });
  const result = await new SourceDiscoveryService(registry).discover(movie);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, 'first');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /inválido/);
});

test('SourceDiscovery preserva fontes parciais quando provider falha', async () => {
  const registry = new ProviderRegistry();
  registry.register({
    id: 'partial', name: 'Partial', playerKind: 'native', isEnabled: () => true,
    findSources: async () => {
      throw new (await import('../dist/providers/provider.types.js')).ProviderSearchError(
        'partial failure',
        [{ id: 'ok', provider: 'Partial', label: 'OK', target: { kind: 'native', transport: 'http', url: 'https://cdn.example/ok.mp4' } }],
        [{ provider: 'Broken addon', message: 'HTTP 503' }],
      );
    },
  });
  const result = await new SourceDiscoveryService(registry).discover(movie);
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.errors, [{ provider: 'Broken addon', message: 'HTTP 503' }]);
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
    waitUntilReady: async () => {},
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

test('StremioAddonProvider preserva trackers junto do candidato torrent', async () => {
  const addon = {
    manifestUrl: 'https://addon.example/manifest.json', baseUrl: 'https://addon.example',
    manifest: { id: 'addon.example', version: '1.0.0', name: 'Example Addon', resources: ['stream'], types: ['movie'] }, status: 'ready',
  };
  const registry = { waitUntilReady: async () => {}, enabled: () => [addon], recordRequest() {}, getHealth: () => ({ score: 0 }) };
  const provider = new (await import('../dist/providers/stremio-addons/stremio-addon.provider.js')).StremioAddonProvider(registry);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ streams: [{
    name: 'Torrent', infoHash: 'abcdef0123456789abcdef0123456789abcdef01', fileIdx: 2,
    sources: ['tracker:udp://tracker.example:6969', 'dht:'],
  }] }), { status: 200 });
  try {
    const sources = await provider.findSources(movie);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].target.kind, 'torrent');
    assert.equal(sources[0].target.fileIdx, 2);
    assert.deepEqual(sources[0].target.trackers, ['udp://tracker.example:6969']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StremioAddonProvider mantém resultados válidos quando outro addon falha com 403', async () => {
  const good = {
    manifestUrl: 'https://good.example/manifest.json', baseUrl: 'https://good.example',
    manifest: { id: 'good', version: '1.0.0', name: 'Good', resources: ['stream'] }, status: 'ready',
  };
  const bad = {
    manifestUrl: 'https://bad.example/manifest.json', baseUrl: 'https://bad.example',
    manifest: { id: 'bad', version: '1.0.0', name: 'Bad', resources: ['stream'] }, status: 'ready',
  };
  const registry = { waitUntilReady: async () => {}, enabled: () => [good, bad], recordRequest() {}, getHealth: () => ({ score: 0 }) };
  const provider = new (await import('../dist/providers/stremio-addons/stremio-addon.provider.js')).StremioAddonProvider(registry);
  const originalFetch = globalThis.fetch;
  let badRequests = 0;
  globalThis.fetch = async (url) => String(url).includes('bad.example')
    ? (badRequests += 1, new Response('Forbidden', { status: 403 }))
    : new Response(JSON.stringify({ streams: [{ name: 'Torrent', infoHash: 'abcdef0123456789abcdef0123456789abcdef01' }] }), { status: 200 });
  try {
    await assert.rejects(provider.findSources(movie), (error) => {
      assert.equal(error.failures.length, 1);
      assert.equal(error.failures[0].provider, 'Bad');
      assert.equal(error.sources.length, 1);
      return true;
    });
    await assert.rejects(provider.findSources(movie), (error) => {
      assert.equal(error.failures.length, 1);
      assert.match(error.failures[0].message, /pausada/);
      assert.equal(error.sources.length, 1);
      return true;
    });
    assert.equal(badRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Internet Archive só retorna filme com título exato, arquivo de vídeo e licença aberta explícita', async () => {
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
    assert.deepEqual(sources[0].authorization, { status: 'creative-commons', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' });
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


test('descoberta coleta manifests diretos e instâncias do diretório', () => {
  assert.deepEqual(
    collectManifestUrls([
      { manifestUrl: 'https://one.example/manifest.json' },
      { manifest_url: 'https://two.example' },
      { instances: [{ transportUrl: 'https://three.example/addon' }] },
    ]),
    [
      'https://one.example/manifest.json',
      'https://two.example/manifest.json',
      'https://three.example/addon/manifest.json',
    ],
  );
});

test('descoberta rejeita destinos locais para evitar SSRF', async () => {
  assert.equal(await isSafeAddonUrl('http://127.0.0.1/manifest.json'), false);
  assert.equal(await isSafeAddonUrl('http://192.168.1.10/manifest.json'), false);
  assert.equal(await isSafeAddonUrl('http://localhost/manifest.json'), false);
  assert.equal(await isSafeAddonUrl('file:///etc/passwd'), false);
});

test('AddonRegistryService mantém configuração manual quando descoberta está desativada', async () => {
  const config = {
    get: (key) => ({
      STREMIO_ADDON_DISCOVERY_ENABLED: 'false',
      STREMIO_ADDON_URLS: 'http://127.0.0.1:9999/manifest.json',
    })[key],
  };
  const registry = new AddonRegistryService(config);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'manual.addon', version: '1.0.0', name: 'Manual Addon', resources: ['stream'], types: ['movie'],
  }), { status: 200 });
  try {
    const addons = await registry.refresh();
    assert.equal(addons.length, 1);
    assert.equal(registry.enabled()[0].manifest.id, 'manual.addon');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
