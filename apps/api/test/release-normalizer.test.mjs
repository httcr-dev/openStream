import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReleaseMetadata } from '../dist/providers/release-normalizer.js';

test('normaliza release com qualidade, codec, áudio, idioma, tamanho e seeders', () => {
  const result = normalizeReleaseMetadata({
    title: 'Example.Show.S02E03.2024.1080p.WEB-DL.HEVC.DUAL.AUDIO.PT-BR.1.4GB.777 seeders',
    description: 'Legendas PT-BR e EN',
  });
  assert.equal(result.title, 'Example Show');
  assert.equal(result.year, 2024);
  assert.equal(result.season, 2);
  assert.equal(result.episode, 3);
  assert.equal(result.quality, '1080p');
  assert.equal(result.releaseType, 'WEB-DL');
  assert.equal(result.codec, 'HEVC');
  assert.equal(result.audio, 'Dual Audio');
  assert.deepEqual(result.subtitles, ['PT-BR', 'EN']);
  assert.equal(result.sizeBytes, 1_503_238_554);
  assert.equal(result.seeders, 777);
});

test('reconhece Blu-ray 4K e padrão temporada x episódio', () => {
  const result = normalizeReleaseMetadata({ title: 'Some.Series.2x07.2160p.BluRay.x265.5.1' });
  assert.equal(result.season, 2);
  assert.equal(result.episode, 7);
  assert.equal(result.quality, '2160p');
  assert.equal(result.releaseType, 'BluRay');
  assert.equal(result.codec, 'HEVC');
  assert.equal(result.audio, '5.1');
});

test('não inventa metadados ausentes nem interpreta números arbitrários como seeders', () => {
  const result = normalizeReleaseMetadata({ title: 'A Simple Movie 2022' });
  assert.equal(result.year, 2022);
  assert.equal(result.quality, undefined);
  assert.equal(result.codec, undefined);
  assert.equal(result.seeders, undefined);
  assert.deepEqual(result.subtitles, []);
});
