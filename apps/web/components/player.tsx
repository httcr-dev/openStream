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
export function Player({
  source,
  onPlaybackError,
}: {
  source: PlaybackSource;
  onPlaybackError?: (reason: string) => void;
}) {
  const { target } = source;

  if (target.kind === 'torrent') {
    return <NativePlayer key={source.id} transport="http" url={torrentStreamUrl(target)} onPlaybackError={onPlaybackError} />;
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
  return <NativePlayer key={source.id} transport={target.transport} url={target.url} onPlaybackError={onPlaybackError} />;
}

function NativePlayer({
  transport,
  url,
  onPlaybackError,
}: {
  transport: 'http' | 'hls';
  url: string;
  onPlaybackError?: (reason: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onPlaybackError);
  const reportedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  callbackRef.current = onPlaybackError;

  const reportError = (message: string) => {
    setError(message);
    if (reportedRef.current) return;
    reportedRef.current = true;
    callbackRef.current?.(message);
  };

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setError(null);
    reportedRef.current = false;

    if (transport === 'http') {
      video.src = url;
      return () => { video.removeAttribute('src'); video.load(); };
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      return () => { video.removeAttribute('src'); video.load(); };
    }

    let hls: import('hls.js').default | undefined;
    let cancelled = false;
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        reportError('Este navegador não suporta HLS.');
        return;
      }
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) reportError(`Erro de reprodução HLS (${data.type}).`);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    });

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
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
          onError={() => reportError(
            transport === 'http'
              ? 'Não foi possível reproduzir este arquivo. Verifique a origem e a compatibilidade do codec.'
              : 'Não foi possível reproduzir este arquivo (formato não suportado pelo navegador?).',
          )}
        />
      </div>
      {error && <p className="err">{error}</p>}
    </>
  );
}
