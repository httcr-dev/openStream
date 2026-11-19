import { Controller, Get, Logger, Param, ParseIntPipe, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TorrentPlaybackService } from './torrent-playback.service.js';

@Controller('playback/torrents')
export class TorrentPlaybackController {
  private readonly logger = new Logger(TorrentPlaybackController.name);

  constructor(private readonly torrents: TorrentPlaybackService) {}

  @Get(':infoHash/:fileIdx/stream')
  stream(
    @Param('infoHash') infoHash: string,
    @Param('fileIdx', ParseIntPipe) fileIdx: number,
    @Query('tracker') trackers: string[] | string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.logger.log(`Incoming torrent stream: hash=${infoHash}, fileIdx=${fileIdx}, range=${req.headers.range ?? 'none'}, trackers=${trackers ? (Array.isArray(trackers) ? trackers.length : 1) : 0}`);
    return this.torrents.stream(infoHash, fileIdx, trackers, req, res);
  }
}
