'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, type ResolveResult } from '@/lib/api';

/** Busca as fontes de reprodução de um filme ou episódio e lista cada uma. */
export function SourcesList({
  mediaId,
  season,
  episode,
}: {
  mediaId: string;
  season?: number;
  episode?: number;
}) {
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.sources(mediaId, season, episode));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao buscar fontes');
    } finally {
      setLoading(false);
    }
  }

  const qs = (sourceId: string) => {
    const p = new URLSearchParams({ id: mediaId, source: sourceId });
    if (season) p.set('season', String(season));
    if (episode) p.set('episode', String(episode));
    return p.toString();
  };

  return (
    <div>
      <button onClick={find} disabled={loading}>
        {loading ? 'Procurando fontes…' : 'Encontrar fontes'}
      </button>
      {error && <p className="err">{error}</p>}

      {result && (
        <div style={{ marginTop: 12 }}>
          {result.sources.length === 0 && (
            <p className="muted">Nenhuma fonte reproduzível encontrada para este conteúdo.</p>
          )}
          {result.sources.map((s) => (
            <div className="row" key={s.id}>
              <div>
                <div>{s.label}</div>
                <div>
                  <span className="badge">{s.provider}</span>
                  <span className="badge">{s.target.kind === 'native' ? 'player próprio' : 'player do provedor'}</span>
                  {s.quality && <span className="badge">{s.quality}</span>}
                </div>
              </div>
              <Link className="btn" href={`/watch?${qs(s.id)}${s.providerId ? `&provider=${encodeURIComponent(s.providerId)}` : ''}`}>
                Assistir
              </Link>
            </div>
          ))}
          {result.errors.map((e) => (
            <p className="err" key={e.provider}>
              {e.provider}: {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
