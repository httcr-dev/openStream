'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Player } from '@/components/player';
import { api, type CatalogDetail, type Episode, type PlaybackSource } from '@/lib/api';

type EpisodeLink = { season: number; episode: number; name: string };

function formatBytes(bytes?: number): string | undefined {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function sourceSummary(source: PlaybackSource): string {
  const release = source.release;
  const sourceType = source.target.kind === 'torrent' ? 'P2P'
    : source.target.kind === 'embed' ? 'Embed'
      : source.target.transport === 'hls' ? 'Direto · HLS' : 'Direto';
  const availability = source.availability?.status === 'available' ? 'verificada'
    : source.availability?.status === 'unavailable' ? 'indisponível' : 'não verificada';
  return [
    release?.quality ?? source.quality,
    release?.year ? String(release.year) : undefined,
    release?.season !== undefined && release.episode !== undefined ? `T${release.season}E${release.episode}` : undefined,
    release?.releaseType,
    release?.codec,
    release?.audio,
    release?.subtitles?.length ? release.subtitles.join('+') : undefined,
    formatBytes(release?.sizeBytes),
    release?.seeders !== undefined ? `${release.seeders.toLocaleString('pt-BR')} seeders` : undefined,
    sourceType,
    availability,
  ].filter(Boolean).join(' · ');
}

function Watch() {
  const sp = useSearchParams();
  const id = sp.get('id');
  const sourceId = sp.get('source');
  const preferredProvider = sp.get('provider') ?? undefined;
  const season = sp.get('season') ? Number(sp.get('season')) : undefined;
  const episode = sp.get('episode') ? Number(sp.get('episode')) : undefined;

  const [title, setTitle] = useState('');
  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [providerErrors, setProviderErrors] = useState<{ provider: string; message: string }[]>([]);
  const [current, setCurrent] = useState<string | null>(sourceId);
  const [error, setError] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<string | null>(null);
  const [failoverLoading, setFailoverLoading] = useState(false);
  const [failedSourceIds, setFailedSourceIds] = useState<string[]>([]);
  const failoverLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [previousEpisode, setPreviousEpisode] = useState<EpisodeLink | null>(null);
  const [nextEpisode, setNextEpisode] = useState<EpisodeLink | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setPlaybackStatus(null);
    setFailedSourceIds([]);
    failoverLock.current = false;
    api.sources(id, season, episode, preferredProvider)
      .then((result) => {
        setTitle(result.media.title);
        setSources(result.sources);
        setProviderErrors(result.errors ?? []);
        setCurrent((selected) => selected && result.sources.some((source) => source.id === selected)
          ? selected
          : result.sources[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, season, episode, preferredProvider]);

  useEffect(() => {
    if (!id || season === undefined || episode === undefined) return;
    const match = /^tmdb:series:(\d+)$/.exec(id);
    if (!match) return;
    let cancelled = false;

    setPreviousEpisode(null);
    setNextEpisode(null);
    async function loadNavigation() {
      try {
        const detail: CatalogDetail = await api.detail('series', match![1]);
        if (cancelled) return;
        setTitle(detail.title);
        const seasons = [...(detail.seasons ?? [])].sort((a, b) => a.seasonNumber - b.seasonNumber);
        const currentSeasonEpisodes = await api.episodes(match![1], season!);
        if (cancelled) return;
        const currentIndex = currentSeasonEpisodes.findIndex((item) => item.episodeNumber === episode);
        const currentEpisode = currentSeasonEpisodes[currentIndex];

        if (currentIndex > 0) {
          const previous = currentSeasonEpisodes[currentIndex - 1];
          setPreviousEpisode({ season: season!, episode: previous.episodeNumber, name: previous.name });
        } else {
          const previousSeason = [...seasons].reverse().find((item) => item.seasonNumber < season!);
          if (previousSeason) {
            const list = await api.episodes(match![1], previousSeason.seasonNumber);
            const last = list[list.length - 1];
            if (last) setPreviousEpisode({ season: previousSeason.seasonNumber, episode: last.episodeNumber, name: last.name });
          } else setPreviousEpisode(null);
        }

        if (currentIndex >= 0 && currentIndex < currentSeasonEpisodes.length - 1) {
          const next = currentSeasonEpisodes[currentIndex + 1];
          setNextEpisode({ season: season!, episode: next.episodeNumber, name: next.name });
        } else {
          const nextSeason = seasons.find((item) => item.seasonNumber > season!);
          if (nextSeason) {
            const list = await api.episodes(match![1], nextSeason.seasonNumber);
            const first = list[0];
            if (first) setNextEpisode({ season: nextSeason.seasonNumber, episode: first.episodeNumber, name: first.name });
            else setNextEpisode(null);
          } else setNextEpisode(null);
        }
        if (!currentEpisode) setError('Episódio não encontrado no catálogo.');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar episódios.');
      }
    }

    void loadNavigation();
    return () => { cancelled = true; };
  }, [id, season, episode]);

  if (!id) return <p className="err">Conteúdo não informado.</p>;
  if (error) return <p className="err">{error}</p>;
  if (loading) return <p className="muted">Procurando episódios e fontes…</p>;

  const active = sources.find((source) => source.id === current) ?? sources[0];
  const back = id.replace(/^tmdb:(movie|series):/, '/title/$1/');
  const episodeHref = (target: EpisodeLink) => {
    const params = new URLSearchParams({ id, season: String(target.season), episode: String(target.episode) });
    if (active?.providerId) params.set('provider', active.providerId);
    return `/watch?${params.toString()}`;
  };

  async function handlePlaybackError(reason: string) {
    if (!id || !active || failoverLock.current || failedSourceIds.includes(active.id)) return;
    failoverLock.current = true;
    const attempted = [...failedSourceIds, active.id];
    setFailedSourceIds(attempted);
    setFailoverLoading(true);
    setPlaybackStatus('Falha na reprodução. Procurando outra fonte…');

    try {
      const result = await api.failover({
        id,
        season,
        episode,
        provider: preferredProvider,
        failedSourceIds: attempted,
        failedSourceId: active.id,
        failedSourceProvider: active.provider,
        reason,
      });
      setSources((currentSources) => {
        const known = new Set(currentSources.map((source) => source.id));
        return [...currentSources, ...result.sources.filter((source) => !known.has(source.id))];
      });
      if (result.nextSource) {
        setCurrent(result.nextSource.id);
        setPlaybackStatus(`Fonte alternativa: ${result.nextSource.provider} · ${result.nextSource.label}`);
        failoverLock.current = false;
      } else {
        setPlaybackStatus('Esta fonte falhou e não há outras fontes disponíveis para este conteúdo.');
      }
    } catch (e) {
      setPlaybackStatus(`Não foi possível buscar outra fonte: ${e instanceof Error ? e.message : 'erro desconhecido'}`);
      failoverLock.current = false;
    } finally {
      setFailoverLoading(false);
    }
  }

  return (
    <>
      <p><Link href={back} className="muted">← {title}{season && episode ? ` · T${season}E${episode}` : ''}</Link></p>
      {active
        ? <Player key={active.id} source={active} onPlaybackError={(reason) => void handlePlaybackError(reason)} />
        : <p className="muted">Nenhuma fonte encontrada para este conteúdo.</p>}
      {playbackStatus && <p className={failoverLoading ? 'muted' : 'err'} role="status">{playbackStatus}</p>}
      {active && <>
        <div className="sourcebar">
          {sources.map((source) => (
            <button key={source.id} className={source.id === active.id ? '' : 'secondary'}
              disabled={failoverLoading || failedSourceIds.includes(source.id)}
              onClick={() => { setCurrent(source.id); setPlaybackStatus(null); }}>
              {source.provider} · {source.release?.title || source.label} · {sourceSummary(source)}
              {failedSourceIds.includes(source.id) ? ' · falhou' : ''}
            </button>
          ))}
        </div>
        <p className="muted">{active.release?.title || active.label}</p>
        <p className="muted" aria-label="Detalhes da fonte">{sourceSummary(active)}</p>
        {active.availability?.reason && <p className="muted">{active.availability.reason}</p>}
      </>}
      {providerErrors.length > 0 && (
        <section aria-label="Falhas na busca de fontes">
          <p className="muted">Alguns addons não responderam:</p>
          {providerErrors.map((item, index) => (
            <p className="muted" key={`${item.provider}-${index}`}>{item.provider}: {item.message}</p>
          ))}
        </section>
      )}
      {season !== undefined && episode !== undefined && <div className="row" style={{ justifyContent: 'space-between' }}>
        {previousEpisode ? <Link className="btn secondary" href={episodeHref(previousEpisode)}>← Anterior · T{previousEpisode.season}E{previousEpisode.episode}</Link> : <span />}
        {nextEpisode ? <Link className="btn" href={episodeHref(nextEpisode)}>Próximo · T{nextEpisode.season}E{nextEpisode.episode} →</Link> : <span className="muted">Fim dos episódios disponíveis no catálogo</span>}
      </div>}
    </>
  );
}

export default function WatchPage() {
  return <Suspense fallback={<p className="muted">Carregando…</p>}><Watch /></Suspense>;
}
