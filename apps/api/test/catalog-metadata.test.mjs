import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from '../dist/catalog/catalog.service.js';

function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve().then(run).finally(() => { globalThis.fetch = original; });
}

test('TMDB detail inclui metadados editoriais e técnicos e reutiliza cache', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({
      id: 42,
      title: 'Example Movie',
      original_title: 'Exemplo Original',
      release_date: '2024-04-10',
      overview: 'Synopsis',
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      imdb_id: 'tt1234567',
      runtime: 118,
      genres: [{ id: 1, name: 'Drama' }, { id: 2, name: 'Sci-Fi' }],
      original_language: 'en',
    }), { status: 200 });
  }, async () => {
    const service = new CatalogService({ get: (key) => key === 'TMDB_READ_TOKEN' ? 'token' : undefined });
    const first = await service.detail('movie', 42);
    const second = await service.detail('movie', 42);
    assert.equal(calls, 1);
    assert.equal(first.imdbId, 'tt1234567');
    assert.equal(first.runtimeMinutes, 118);
    assert.deepEqual(first.genres, ['Drama', 'Sci-Fi']);
    assert.equal(first.originalLanguage, 'en');
    assert.equal(second.title, 'Example Movie');
  });
});

test('TMDB detail de série mantém IDs externos, gêneros e temporadas', async () => {
  await withFetch(async (url) => {
    assert.match(String(url), /append_to_response=external_ids/);
    return new Response(JSON.stringify({
      id: 77, name: 'Example Series', original_name: 'Original Series',
      first_air_date: '2020-01-01', overview: 'Series synopsis',
      poster_path: null, backdrop_path: null, original_language: 'ja',
      genres: [{ id: 16, name: 'Animation' }],
      external_ids: { imdb_id: 'tt7654321', tvdb_id: 1234 },
      seasons: [{ season_number: 0, name: 'Specials', episode_count: 2 },
        { season_number: 1, name: 'Season 1', episode_count: 12 }],
    }), { status: 200 });
  }, async () => {
    const service = new CatalogService({ get: (key) => key === 'TMDB_READ_TOKEN' ? 'token' : undefined });
    const detail = await service.detail('series', 77);
    assert.equal(detail.imdbId, 'tt7654321');
    assert.deepEqual(detail.externalIds, { imdbId: 'tt7654321', tvdbId: '1234' });
    assert.deepEqual(detail.genres, ['Animation']);
    assert.equal(detail.seasons.length, 1);
  });
});
