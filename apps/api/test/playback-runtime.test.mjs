import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackRuntimeService } from '../dist/providers/playback-runtime.service.js';

const source = (id, status = 'available') => ({
  id, provider: 'test-provider', label: id,
  target: { kind: 'native', transport: 'http', url: `https://media.example/${id}.mp4` },
  availability: { status, checkedAt: new Date().toISOString() },
});

test('failover registra a falha e retorna a próxima fonte não tentada', async () => {
  const resolver = {
    resolve: async () => ({ media: { id: 'tmdb:movie:1', title: 'Example' }, sources: [source('source-a'), source('source-b')] }),
  };
  const runtime = new PlaybackRuntimeService(resolver);
  const result = await runtime.failover({
    id: 'tmdb:movie:1', failedSourceId: 'source-a', failedSourceIds: ['source-a'], reason: 'HTTP playback error',
  });

  assert.equal(result.nextSource.id, 'source-b');
  assert.equal(result.exhausted, false);
  assert.deepEqual(result.sources.map((item) => item.id), ['source-b']);
  assert.equal(runtime.getStats().totalFailures, 1);
  assert.equal(runtime.getStats().successfulFailovers, 1);
});

test('failover não repete fontes tentadas e registra quando esgota alternativas', async () => {
  const resolver = {
    resolve: async () => ({ media: { id: 'tmdb:movie:1', title: 'Example' }, sources: [source('source-a'), source('source-b')] }),
  };
  const runtime = new PlaybackRuntimeService(resolver);
  const result = await runtime.failover({
    id: 'tmdb:movie:1', failedSourceId: 'source-b', failedSourceIds: ['source-a', 'source-b'], reason: 'network timeout',
  });

  assert.equal(result.nextSource, null);
  assert.equal(result.exhausted, true);
  assert.equal(runtime.getStats().exhaustedFailovers, 1);
});

test('failover descarta fontes indisponíveis e valida payloads', async () => {
  const resolver = {
    resolve: async () => ({
      media: { id: 'tmdb:movie:1', title: 'Example' },
      sources: [source('unavailable', 'unavailable'), source('available')],
    }),
  };
  const runtime = new PlaybackRuntimeService(resolver);
  const result = await runtime.failover({
    id: 'tmdb:movie:1', failedSourceId: 'failed', failedSourceIds: [], reason: 'decode error',
  });
  assert.equal(result.nextSource.id, 'available');
  await assert.rejects(
    runtime.failover({ id: '', failedSourceId: 'x', failedSourceIds: [], reason: 'error' }),
    (error) => error.status === 400,
  );
});
