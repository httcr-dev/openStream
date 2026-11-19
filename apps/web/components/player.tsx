'use client';

import { useEffect, useRef, useState } from 'react';
import { torrentStreamUrl, type PlaybackSource } from '@/lib/api';

/**
 * Player único para os destinos reproduzíveis:
 * - native/http: <video> com Direct Play
 * - native/hls:  <video> com hls.js (ou HLS nativo no Safari/iOS)
 * - embed:       iframe com o player oficial do provedor
 * - torrent:     WebTorrent no backend, exposto como HTTP com suporte a Range
 */
export function Player({ source }: { source: PlaybackSource }) {
  const { target } = source;

  if (target.kind === 'torrent') {
    return <NativePlayer key={source.id} transport="http" url={torrentStreamUrl(target)} />;
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
        <video
          ref={ref}
          controls
          playsInline
          preload="metadata"
          onError={() => setError(
            transport === 'http'
              ? 'Não foi possível reproduzir este arquivo. Verifique se há peers disponíveis e se o navegador suporta o codec.'
              : 'Não foi possível reproduzir este arquivo (formato não suportado pelo navegador?). Tente outra fonte.',
          )}
        />
      </div>
      {error && <p className="err">{error}</p>}
    </>
  );
}
