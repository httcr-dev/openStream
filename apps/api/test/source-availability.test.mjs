import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceAvailabilityValidatorService } from '../dist/providers/source-availability-validator.service.js';

const native = (id, transport = 'http', url = 'https://media.example/video.mp4') => ({
  id, provider: 'test', label: id, target: { kind: 'native', transport, url },
});

function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve().then(run).finally(() => { globalThis.fetch = original; });
}

test('validator marca HTTP disponível usando GET Range sem baixar o arquivo', async () => {
  await withFetch(async (_url, init) => {
    assert.equal(init.headers.Range, 'bytes=0-0');
    return new Response('x', { status: 206, headers: { 'content-type': 'video/mp4' } });
  }, async () => {
    const validator = new SourceAvailabilityValidatorService({ isSafe: async () => true });
    const [result] = await validator.validate([native('http')]);
    assert.equal(result.availability.status, 'available');
    assert.equal(result.availability.contentType, 'video/mp4');
    assert.equal(typeof result.availability.latencyMs, 'number');
  });
});

test('validator aceita playlist HLS válida e rejeita conteúdo que não é playlist', async () => {
  await withFetch(async () => new Response('#EXTM3U\n#EXTINF:6.0,\nsegment-1.ts\n#EXT-X-ENDLIST', {
    status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' },
  }), async () => {
    const validator = new SourceAvailabilityValidatorService({ isSafe: async () => true });
    const [result] = await validator.validate([native('hls', 'hls', 'https://media.example/index.m3u8')]);
    assert.equal(result.availability.status, 'available');
  });

  await withFetch(async () => new Response('<html>not a playlist</html>', { status: 200 }), async () => {
    const validator = new SourceAvailabilityValidatorService({ isSafe: async () => true });
    const result = await validator.validate([native('bad-hls', 'hls', 'https://media.example/bad.m3u8')]);
    assert.deepEqual(result, []);
  });
});

test('validator revalida cada redirect e bloqueia destino inseguro', async () => {
  let safetyCalls = 0;
  let fetchCalls = 0;
  await withFetch(async () => {
    fetchCalls += 1;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  }, async () => {
    const validator = new SourceAvailabilityValidatorService({
      isSafe: async () => (++safetyCalls === 1),
    });
    const result = await validator.validate([native('redirect')]);
    assert.deepEqual(result, []);
    assert.equal(safetyCalls, 2);
    assert.equal(fetchCalls, 1);
  });
});

test('validator descarta respostas HTTP indisponíveis', async () => {
  await withFetch(async () => new Response('forbidden', { status: 403 }), async () => {
    const validator = new SourceAvailabilityValidatorService({ isSafe: async () => true });
    assert.deepEqual(await validator.validate([native('forbidden')]), []);
  });
});

test('validator mantém embed e torrent como unknown sem sondagem externa', async () => {
  let fetchCalls = 0;
  await withFetch(async () => {
    fetchCalls += 1;
    throw new Error('não deveria consultar');
  }, async () => {
    const validator = new SourceAvailabilityValidatorService({ isSafe: async () => true });
    const sources = [
      { id: 'embed', provider: 'embed', label: 'Embed', target: { kind: 'embed', provider: 'x', embedUrl: 'https://embed.example/watch' } },
      { id: 'torrent', provider: 'torrent', label: 'Torrent', target: { kind: 'torrent', infoHash: 'abcdef0123456789abcdef0123456789abcdef01' } },
    ];
    const result = await validator.validate(sources);
    assert.deepEqual(result.map((source) => source.availability.status), ['unknown', 'unknown']);
    assert.equal(fetchCalls, 0);
  });
});

test('validator compartilha probes concorrentes e reutiliza cache curto', async () => {
  let fetchCalls = 0;
  await withFetch(async () => {
    fetchCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response('x', { status: 206 });
  }, async () => {
    const validator = new SourceAvailabilityValidatorService({ isSafe: async () => true });
    const [a, b] = await Promise.all([
      validator.validate([native('a')]),
      validator.validate([native('b')]),
    ]);
    assert.equal(a[0].availability.status, 'available');
    assert.equal(b[0].availability.status, 'available');
    assert.equal(fetchCalls, 1);
  });
});
