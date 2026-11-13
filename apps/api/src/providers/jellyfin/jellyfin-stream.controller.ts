import { BadRequestException, Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { JellyfinClient } from './jellyfin.client.js';

const FORWARD_REQUEST_HEADERS = ['range', 'if-range', 'if-none-match', 'if-modified-since'];
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'cache-control',
];

/**
 * Proxy de mídia do Jellyfin. O navegador só fala com a API do OpenStream;
 * o token do Jellyfin fica no servidor. Suporta HTTP Range (Direct Play) e
 * reescreve playlists HLS.
 */
@Controller('stream/jellyfin')
export class JellyfinStreamController {
  constructor(private readonly jellyfin: JellyfinClient) {}

  @Get('*path')
  async proxy(@Param('path') pathParam: string | string[], @Req() req: Request, @Res() res: ExpressResponse) {
    const path = (Array.isArray(pathParam) ? pathParam.join('/') : pathParam).replace(/^\/+/, '');
    // Allowlist: só o necessário para reprodução de vídeo.
    if (!/^videos\/[0-9a-fA-F-]+\//i.test(path) || path.includes('..')) {
      throw new BadRequestException('Caminho não permitido');
    }

    const qs = new URLSearchParams(req.query as Record<string, string>);
    for (const k of ['api_key', 'ApiKey', 'apikey']) qs.delete(k);
    const query = qs.toString();
    const upstreamPath = query ? `${path}?${query}` : path;

    const headers = new Headers();
    for (const h of FORWARD_REQUEST_HEADERS) {
      const v = req.headers[h];
      if (typeof v === 'string') headers.set(h, v);
    }

    const abort = new AbortController();
    res.on('close', () => abort.abort());

    let upstream: globalThis.Response;
    try {
      upstream = await this.jellyfin.fetchRaw(upstreamPath, { headers, signal: abort.signal });
    } catch {
      if (!res.headersSent) res.status(502).json({ message: 'Jellyfin indisponível' });
      return;
    }

    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type') ?? '';
    const isPlaylist = /mpegurl/i.test(contentType) || path.toLowerCase().endsWith('.m3u8');

    if (isPlaylist && upstream.ok) {
      const text = await upstream.text();
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      res.send(this.rewritePlaylist(text));
      return;
    }

    for (const h of FORWARD_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as never).on('error', () => res.destroy()).pipe(res);
  }

  /**
   * Playlists do Jellyfin usam caminhos relativos (resolvem sob o próprio proxy).
   * Aqui só tratamos caminhos absolutos e removemos qualquer api_key embutida.
   */
  private rewritePlaylist(text: string): string {
    const stripKey = (s: string) =>
      s.replace(/([?&])(api_key|ApiKey)=[^&"\s]*&?/gi, '$1').replace(/[?&]$/, '');
    const fixAbs = (s: string) =>
      /^\/videos\//i.test(s) ? `/api/v1/stream/jellyfin${s}` : s;

    return text
      .split('\n')
      .map((line) => {
        if (line.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${fixAbs(stripKey(uri))}"`);
        }
        return line.trim() ? fixAbs(stripKey(line)) : line;
      })
      .join('\n');
  }
}
