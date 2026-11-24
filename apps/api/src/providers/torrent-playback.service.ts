import {
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebTorrent, { type Torrent, type TorrentFile } from 'webtorrent';
import { parseByteRange, type ByteRange } from './byte-range.js';
export { parseByteRange } from './byte-range.js';

const METADATA_TIMEOUT_MS = 120_000;
const FIRST_BYTE_TIMEOUT_MS = 45_000;
const SESSION_IDLE_MS = 30 * 60_000;
const MAX_ACTIVE_TORRENTS = 5;
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.ogv', '.ogg', '.avi', '.ts', '.mpeg', '.mpg',
]);

type TorrentSessionMetrics = {
  createdAt: number;
  lastUsedAt: number;
  activeStreams: number;
  streamRequests: number;
  trackersCount: number;
  peerCount: number;
  downloadedBytes: number;
  lastPeerAt: number | null;
  lastDownloadAt: number | null;
  metadataAt: number | null;
  readyAt: number | null;
  firstByteTimeouts: number;
  noPeersEvents: number;
  trackerWarnings: number;
  lastError: string | null;
};

type TorrentSession = TorrentSessionMetrics & { torrent: Promise<Torrent> };

function normalizeInfoHash(value: string): string {
  const hash = value.trim();
  if (/^[a-f\d]{40}$/i.test(hash)) return hash.toLowerCase();

  if (/^[a-z2-7]{32}$/i.test(hash)) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let buffer = 0;
    const bytes: number[] = [];
    for (const char of hash.toUpperCase()) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) throw new BadRequestException('Info hash inválido.');
      buffer = (buffer << 5) | digit;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    if (bytes.length !== 20) throw new BadRequestException('Info hash inválido.');
    return Buffer.from(bytes).toString('hex');
  }

  throw new BadRequestException('Info hash inválido.');
}

function isVideoFile(file: TorrentFile): boolean {
  const extension = file.path.slice(file.path.lastIndexOf('.')).toLowerCase();
  return VIDEO_EXTENSIONS.has(extension);
}

function contentType(file: TorrentFile): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const extension = file.path.slice(file.path.lastIndexOf('.')).toLowerCase();
  const types: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.ogv': 'video/ogg',
    '.ogg': 'video/ogg',
    '.avi': 'video/x-msvideo',
    '.ts': 'video/mp2t',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
  };
  return types[extension] ?? 'application/octet-stream';
}

function normalizeTrackers(values: string[] = []): string[] {
  return [...new Set(values)]
    .map((value) => value.trim().replace(/^tracker:/i, ''))
    .filter((value) => {
      try {
        return ['udp:', 'http:', 'https:', 'ws:', 'wss:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    })
    .slice(0, 20);
}

@Injectable()
export class TorrentPlaybackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TorrentPlaybackService.name);
  private readonly sessions = new Map<string, TorrentSession>();
  private client?: WebTorrent;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const storagePath = this.config.get<string>('OPENSTREAM_TORRENT_PATH')
      ?? join(tmpdir(), 'openstream-torrents');
    await mkdir(storagePath, { recursive: true });

    this.client = new WebTorrent({
      maxConns: 40,
      natUpnp: false,
      natPmp: false,
      uploadLimit: 0,
    });
    this.client.on('error', (error) => {
      this.logger.error(`WebTorrent client error: ${error instanceof Error ? error.message : String(error)}`);
    });

    this.cleanupTimer = setInterval(() => void this.cleanupIdleSessions(), 60_000);
    this.cleanupTimer.unref();
  }

  getStats() {
    const now = Date.now();
    const sessions = [...this.sessions.entries()].map(([infoHash, session]) => ({
      infoHash: `${infoHash.slice(0, 8)}…`,
      state: session.readyAt ? (session.activeStreams > 0 ? 'streaming' : 'ready') : 'fetching-metadata',
      ageMs: now - session.createdAt,
      lastUsedAgoMs: now - session.lastUsedAt,
      activeStreams: session.activeStreams,
      streamRequests: session.streamRequests,
      trackersCount: session.trackersCount,
      peers: session.peerCount,
      downloadedBytes: session.downloadedBytes,
      lastPeerAt: session.lastPeerAt,
      lastDownloadAt: session.lastDownloadAt,
      metadataAt: session.metadataAt,
      readyAt: session.readyAt,
      firstByteTimeouts: session.firstByteTimeouts,
      noPeersEvents: session.noPeersEvents,
      trackerWarnings: session.trackerWarnings,
      lastError: session.lastError,
    }));
    return {
      clientReady: Boolean(this.client && !this.client.destroyed),
      activeSessions: sessions.length,
      activeStreams: sessions.reduce((total, session) => total + session.activeStreams, 0),
      limits: { maxActiveTorrents: MAX_ACTIVE_TORRENTS, metadataTimeoutMs: METADATA_TIMEOUT_MS, firstByteTimeoutMs: FIRST_BYTE_TIMEOUT_MS },
      sessions,
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (!this.client) return;
    await new Promise<void>((resolve) => this.client!.destroy(() => resolve()));
    this.sessions.clear();
  }

  async stream(infoHashInput: string, fileIdx: number, trackersInput: string[] | string | undefined, req: Request, res: Response): Promise<void> {
    const infoHash = normalizeInfoHash(infoHashInput);
    if (!Number.isInteger(fileIdx) || fileIdx < -1) throw new BadRequestException('Índice de arquivo inválido.');

    const trackers = normalizeTrackers(
      Array.isArray(trackersInput) ? trackersInput : trackersInput ? [trackersInput] : [],
    );
    const { session, file } = await this.getFile(infoHash, fileIdx, trackers);
    session.lastUsedAt = Date.now();
    session.streamRequests += 1;
    const streamStartedAt = Date.now();

    const range = parseByteRange(req.headers.range, file.length);
    if (range === false) {
      res.status(416).setHeader('Content-Range', `bytes */${file.length}`).end();
      return;
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? file.length - 1;
    const contentLength = end - start + 1;

    res.status(range ? 206 : 200);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType(file));
    res.setHeader('Content-Length', String(contentLength));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${file.length}`);

    session.activeStreams += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      session.activeStreams = Math.max(0, session.activeStreams - 1);
      session.lastUsedAt = Date.now();
    };
    res.once('close', release);
    res.once('finish', release);

    const failStream = (error: Error) => {
      this.logger.warn(`Torrent stream failed for ${infoHash}: ${error.message}`);
      release();
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Range');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(error.message.startsWith('FIRST_BYTE_TIMEOUT:') ? 504 : 500).end(
        error.message.startsWith('FIRST_BYTE_TIMEOUT:')
          ? 'Nenhum dado chegou dos peers dentro do tempo limite.'
          : 'Falha ao ler o arquivo do torrent.',
      );
    };

    try {
      const fileStream = file.createReadStream(range ? { start, end } : undefined);
      let firstByteReceived = false;
      const firstByteTimeout = setTimeout(() => {
        if (firstByteReceived || res.destroyed) return;
        session.firstByteTimeouts += 1;
        session.lastError = 'FIRST_BYTE_TIMEOUT';
        this.logger.warn(`Torrent first-byte timeout: hash=${infoHash}, peers=${session.peerCount}, downloaded=${session.downloadedBytes}, trackers=${session.trackersCount}, elapsedMs=${Date.now() - streamStartedAt}`);
        fileStream.destroy(new Error('FIRST_BYTE_TIMEOUT: aguardando dados dos peers.'));
      }, FIRST_BYTE_TIMEOUT_MS);
      firstByteTimeout.unref();

      fileStream.once('error', (error) => {
        clearTimeout(firstByteTimeout);
        failStream(error);
      });
      fileStream.once('data', (chunk: Buffer) => {
        firstByteReceived = true;
        session.lastError = null;
        session.lastUsedAt = Date.now();
        this.logger.log(`Torrent first byte received: hash=${infoHash}, peers=${session.peerCount}, elapsedMs=${Date.now() - streamStartedAt}, bytes=${chunk.length}`);
        clearTimeout(firstByteTimeout);
        if (res.destroyed) {
          fileStream.destroy();
          return;
        }
        res.write(chunk);
        fileStream.pipe(res);
      });
      res.once('close', () => {
        clearTimeout(firstByteTimeout);
        if (!res.writableEnded) fileStream.destroy();
      });
    } catch (error) {
      failStream(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async getFile(infoHash: string, fileIdx: number, trackers: string[]): Promise<{ session: TorrentSession; file: TorrentFile }> {
    if (!this.client || this.client.destroyed) {
      throw new ServiceUnavailableException('Motor P2P indisponível.');
    }

    let session = this.sessions.get(infoHash);
    if (!session) {
      if (this.sessions.size >= MAX_ACTIVE_TORRENTS) {
        throw new HttpException('Limite de torrents ativos atingido. Tente novamente em alguns minutos.', HttpStatus.TOO_MANY_REQUESTS);
      }
      const createdAt = Date.now();
      const metrics: TorrentSessionMetrics = {
        createdAt, lastUsedAt: createdAt, activeStreams: 0, streamRequests: 0,
        trackersCount: trackers.length, peerCount: 0, downloadedBytes: 0,
        lastPeerAt: null, lastDownloadAt: null, metadataAt: null, readyAt: null,
        firstByteTimeouts: 0, noPeersEvents: 0, trackerWarnings: 0, lastError: null,
      };
      session = { ...metrics, torrent: this.addTorrent(infoHash, trackers, metrics) };
      this.sessions.set(infoHash, session);
      const current = session;
      void current.torrent.catch(() => {
        if (this.sessions.get(infoHash) === current) this.sessions.delete(infoHash);
      });
    }

    session.lastUsedAt = Date.now();
    const torrent = await session.torrent;
    let file: TorrentFile | undefined;

    if (fileIdx === -1) {
      file = [...torrent.files].filter(isVideoFile).sort((a, b) => b.length - a.length)[0];
    } else {
      file = torrent.files[fileIdx];
    }

    if (!file) throw new NotFoundException('Arquivo não encontrado dentro do torrent.');
    if (!isVideoFile(file)) throw new UnsupportedMediaTypeException('O item selecionado não é um arquivo de vídeo.');
    return { session, file };
  }

  private addTorrent(infoHash: string, trackers: string[], metrics: TorrentSessionMetrics): Promise<Torrent> {
    const client = this.client;
    if (!client) return Promise.reject(new ServiceUnavailableException('Motor P2P indisponível.'));

    return new Promise<Torrent>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        metrics.lastError = 'METADATA_TIMEOUT';
        this.logger.warn(`Torrent metadata timeout: hash=${infoHash}, trackers=${metrics.trackersCount}, peers=${metrics.peerCount}, elapsedMs=${Date.now() - metrics.createdAt}`);
        reject(new GatewayTimeoutException('Tempo esgotado aguardando os metadados do torrent.'));
        void client.remove(infoHash, { destroyStore: true }).catch(() => undefined);
      }, METADATA_TIMEOUT_MS);

      const torrent = client.add(infoHash, {
        announce: trackers,
        path: this.config.get<string>('OPENSTREAM_TORRENT_PATH') ?? join(tmpdir(), 'openstream-torrents'),
        strategy: 'sequential',
        addUID: true,
      }, (readyTorrent) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        metrics.readyAt = Date.now();
        metrics.lastError = null;
        this.logger.log(`Torrent ready: hash=${infoHash}, files=${readyTorrent.files.length}, peers=${readyTorrent.numPeers}, metadataMs=${metrics.metadataAt ? metrics.metadataAt - metrics.createdAt : Date.now() - metrics.createdAt}`);
        resolve(readyTorrent);
      });

      let lastProgressLogAt = 0;
      torrent.on('metadata', () => {
        metrics.metadataAt = Date.now();
        this.logger.log(`Torrent metadata received: hash=${infoHash}, files=${torrent.files.length}, trackers=${trackers.length}, elapsedMs=${metrics.metadataAt - metrics.createdAt}`);
      });
      torrent.on('wire', () => {
        metrics.peerCount = torrent.numPeers;
        metrics.lastPeerAt = Date.now();
        if (metrics.peerCount === 1 || metrics.peerCount % 5 === 0) {
          this.logger.log(`Torrent peer connected: hash=${infoHash}, peers=${metrics.peerCount}, elapsedMs=${Date.now() - metrics.createdAt}`);
        }
      });
      torrent.on('noPeers', (announceType) => {
        metrics.noPeersEvents += 1;
        if (metrics.noPeersEvents === 1 || metrics.noPeersEvents % 10 === 0) {
          this.logger.warn(`Torrent peer discovery empty: hash=${infoHash}, source=${announceType}, trackers=${trackers.length}, attempts=${metrics.noPeersEvents}, peers=${torrent.numPeers}`);
        }
      });
      torrent.on('download', (bytes) => {
        const now = Date.now();
        if (now - lastProgressLogAt < 5_000) return;
        lastProgressLogAt = now;
        metrics.peerCount = torrent.numPeers;
        metrics.downloadedBytes = torrent.downloaded;
        metrics.lastDownloadAt = now;
        this.logger.log(`Torrent download progress: hash=${infoHash}, peers=${metrics.peerCount}, downloaded=${metrics.downloadedBytes}, lastChunk=${bytes}, elapsedMs=${now - metrics.createdAt}`);
      });
      torrent.on('warning', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        metrics.trackerWarnings += 1;
        metrics.lastError = message;
        this.logger.warn(`Torrent warning: hash=${infoHash}, warningCount=${metrics.trackerWarnings}, peers=${metrics.peerCount}, trackers=${metrics.trackersCount}, message=${message}`);
      });

      torrent.on('error', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        metrics.lastError = message;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new ServiceUnavailableException(`Não foi possível inicializar o torrent: ${message}`));
        } else {
          this.logger.warn(`Torrent ${infoHash} error: ${message}`);
        }
      });
    });
  }

  private async cleanupIdleSessions(): Promise<void> {
    if (!this.client) return;
    const now = Date.now();
    for (const [infoHash, session] of this.sessions) {
      if (session.activeStreams > 0 || now - session.lastUsedAt < SESSION_IDLE_MS) continue;
      this.sessions.delete(infoHash);
      try {
        await this.client.remove(infoHash, { destroyStore: true });
      } catch (error) {
        this.logger.warn(`Could not remove idle torrent ${infoHash}: ${String(error)}`);
      }
    }
  }
}
