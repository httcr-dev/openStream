'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlaybackSource } from '@/lib/api';

/**
 * Player único para os destinos reproduzíveis:
 * - native/http: <video> com Direct Play
 * - native/hls:  <video> com hls.js (ou HLS nativo no Safari/iOS)
 * - embed:       iframe com o player oficial do provedor
 * - torrent:     candidato descoberto; requer engine P2P para reproduzir
 */
export function Player({ source }: { source: PlaybackSource }) {
  const { target } = source;

  if (target.kind === 'torrent') {
    return (
      <div className="player" style={{ display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div>
          <strong>Fonte torrent encontrada</strong>
          <p className="muted">O addon encontrou este arquivo, mas o OpenStream ainda não tem um mecanismo P2P para reproduzi-lo.</p>
          <p className="muted">Info hash: <code>{target.infoHash}</code></p>
          {target.fileIdx !== undefined && <p className="muted">Arquivo no torrent: {target.fileIdx}</p>}
          {target.externalUrl && (
            <p><a href={target.externalUrl} target="_blank" rel="noreferrer">Abrir página da fonte</a></p>
          )}
        </div>
      </div>
    );
  }

  if (target.kind === 'embed') {
    return (
      <div className="player">
        <iframe
          key={source.id}
          src={target.embedUrl}
          title={source.label}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms"
        />
      </div>
    );
  }
  return <NativePlayer key={source.id} transport={target.transport} url={target.url} />;
}

function NativePlayer({ transport, url }: { transport: 'http' | 'hls'; url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setError(null);

    if (transport === 'http') {
      video.src = url;
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      return;
    }

    let hls: import('hls.js').default | undefined;
    let cancelled = false;
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setError('Este navegador não suporta HLS.');
        return;
      }
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError(`Erro de reprodução HLS (${data.type}).`);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [transport, url]);

  return (
    <>
      <div className="player">
        <video ref={ref} controls playsInline preload="metadata" onError={() => transport === 'http' && setError('Não foi possível reproduzir este arquivo (formato não suportado pelo navegador?). Tente a fonte HLS.')} />
      </div>
      {error && <p className="err">{error}</p>}
    </>
  );
}
