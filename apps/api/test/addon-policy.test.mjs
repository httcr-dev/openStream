import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isManifestEligible,
  isAddonAllowed,
  cooldownForStatus,
  isPlaybackCandidate,
} from '../dist/providers/stremio-addons/addon-policy.js';

const manifest = (overrides = {}) => ({
  id: 'org.example.public-domain',
  version: '1.0.0',
  name: 'Example',
  resources: [{ name: 'stream', types: ['movie'], idPrefixes: ['tt'] }],
  types: ['movie'],
  idPrefixes: ['tt'],
  ...overrides,
});

test('manifest só é elegível quando declara stream, tipos e prefixos compatíveis', () => {
  assert.equal(isManifestEligible(manifest(), 'movie', 'tt123'), true);
  assert.equal(isManifestEligible(manifest({ resources: ['catalog'] }), 'movie', 'tt123'), false);
  assert.equal(isManifestEligible(manifest({ types: undefined }), 'movie', 'tt123'), true);
  assert.equal(isManifestEligible(manifest({ idPrefixes: undefined }), 'movie', 'tt123'), true);
  assert.equal(isManifestEligible(manifest({ types: undefined, idPrefixes: undefined, resources: [{ name: 'stream' }] }), 'movie', 'tt123'), false);
  assert.equal(isManifestEligible(manifest(), 'series', 'tt123:1:1'), false);
});

test('somente addons explicitamente allowlisted são admitidos', () => {
  assert.equal(isAddonAllowed('org.example.public-domain', ['org.example.public-domain']), true);
  assert.equal(isAddonAllowed('org.example.other', ['org.example.public-domain']), false);
  assert.equal(isAddonAllowed('org.example.public-domain', []), false);
});

test('cooldown aumenta para rate limit e falhas temporárias, e é nulo para erros permanentes', () => {
  assert.equal(cooldownForStatus(400), 60_000);
  assert.equal(cooldownForStatus(404), 60 * 60_000);
  assert.equal(cooldownForStatus(403), 15 * 60_000);
  assert.equal(cooldownForStatus(429), 10 * 60_000);
  assert.equal(cooldownForStatus(503), 2 * 60_000);
  assert.equal(cooldownForStatus(200), 0);
});

test('fonte só vira candidata automática com autorização e evidência de disponibilidade', () => {
  const base = {
    id: 'source-1',
    provider: 'Example',
    label: 'Public domain stream',
    authorization: { status: 'public-domain', licenseUrl: 'https://example.org/license' },
    target: { kind: 'native', transport: 'http', url: 'https://cdn.example.org/movie.mp4' },
    availability: { status: 'available', checkedAt: new Date().toISOString() },
  };
  assert.equal(isPlaybackCandidate(base), true);
  assert.equal(isPlaybackCandidate({ ...base, availability: { status: 'unknown' } }), false);
  assert.equal(isPlaybackCandidate({ ...base, authorization: undefined }), false);
  assert.equal(isPlaybackCandidate({ ...base, authorization: { status: 'licensed' } }), false);
  assert.equal(isPlaybackCandidate({ ...base, target: { kind: 'torrent', infoHash: 'a'.repeat(40) } }), false);
});
