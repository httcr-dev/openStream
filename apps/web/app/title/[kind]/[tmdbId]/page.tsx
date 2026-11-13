'use client';

import { notFound, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SourcesList } from '@/components/sources-list';
import { api, type CatalogDetail, type Episode, type MediaKind } from '@/lib/api';

export default function TitlePage() {
  const { kind, tmdbId } = useParams<{ kind: string; tmdbId: string }>();
  if (kind !== 'movie' && kind !== 'series') notFound();

  const [detail, setDetail] = useState<CatalogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [openEp, setOpenEp] = useState<number | null>(null);

  useEffect(() => {
    api
      .detail(kind as MediaKind, tmdbId)
      .then((d) => {
        setDetail(d);
        if (d.seasons?.length) setSeason(d.seasons[0].seasonNumber);
      })
      .catch((e: Error) => setError(e.message));
  }, [kind, tmdbId]);

  useEffect(() => {
    if (kind !== 'series') return;
    setOpenEp(null);
    api.episodes(tmdbId, season).then(setEpisodes).catch((e: Error) => setError(e.message));
  }, [kind, tmdbId, season]);

  if (error) return <p className="err">{error}</p>;
  if (!detail) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="hero">
        {detail.posterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={detail.posterUrl} alt={detail.title} />
        )}
        <div>
          <h1>
            {detail.title} {detail.year ? <span className="muted">({detail.year})</span> : null}
          </h1>
          {detail.originalTitle && detail.originalTitle !== detail.title && (
            <div className="muted">{detail.originalTitle}</div>
          )}
          <p>{detail.overview || 'Sem sinopse.'}</p>
        </div>
      </div>

      {kind === 'movie' ? (
        <div className="panel">
          <h2>Fontes de reprodução</h2>
          <SourcesList mediaId={detail.id} />
        </div>
      ) : (
        <div className="panel">
          <h2>Episódios</h2>
          <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
            {detail.seasons?.map((s) => (
              <option key={s.seasonNumber} value={s.seasonNumber}>
                {s.name} ({s.episodeCount} ep.)
              </option>
            ))}
          </select>
          {episodes.map((ep) => (
            <div key={ep.episodeNumber} style={{ borderTop: '1px solid var(--surface-2)', marginTop: 12, paddingTop: 12 }}>
              <div className="row" style={{ border: 0, padding: 0 }}>
                <div>
                  <strong>{ep.episodeNumber}.</strong> {ep.name}
                </div>
                <button className="secondary" onClick={() => setOpenEp(openEp === ep.episodeNumber ? null : ep.episodeNumber)}>
                  {openEp === ep.episodeNumber ? 'Fechar' : 'Fontes'}
                </button>
              </div>
              {openEp === ep.episodeNumber && (
                <div style={{ marginTop: 10 }}>
                  <SourcesList key={`${season}-${ep.episodeNumber}`} mediaId={detail.id} season={season} episode={ep.episodeNumber} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
