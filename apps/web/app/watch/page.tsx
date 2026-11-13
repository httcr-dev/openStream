'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Player } from '@/components/player';
import { api, type PlaybackSource } from '@/lib/api';

function Watch() {
  const sp = useSearchParams();
  const id = sp.get('id');
  const sourceId = sp.get('source');
  const season = sp.get('season') ? Number(sp.get('season')) : undefined;
  const episode = sp.get('episode') ? Number(sp.get('episode')) : undefined;

  const [title, setTitle] = useState('');
  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [current, setCurrent] = useState<string | null>(sourceId);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api
      .sources(id, season, episode)
      .then((r) => {
        setTitle(r.media.title);
        setSources(r.sources);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, season, episode]);

  if (!id) return <p className="err">Conteúdo não informado.</p>;
  if (error) return <p className="err">{error}</p>;
  if (loading) return <p className="muted">Carregando fonte…</p>;

  const active = sources.find((s) => s.id === current) ?? sources[0];
  if (!active) return <p className="muted">Nenhuma fonte disponível.</p>;

  const back = id.replace(/^tmdb:(movie|series):/, '/title/$1/');

  return (
    <>
      <p>
        <Link href={back} className="muted">
          ← {title}
          {season && episode ? ` · T${season}E${episode}` : ''}
        </Link>
      </p>
      <Player source={active} />
      <div className="sourcebar">
        {sources.map((s) => (
          <button key={s.id} className={s.id === active.id ? '' : 'secondary'} onClick={() => setCurrent(s.id)}>
            {s.provider} · {s.target.kind === 'native' ? (s.quality ?? 'nativo') : 'embed'}
          </button>
        ))}
      </div>
      <p className="muted">{active.label}</p>
    </>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={<p className="muted">Carregando…</p>}>
      <Watch />
    </Suspense>
  );
}
