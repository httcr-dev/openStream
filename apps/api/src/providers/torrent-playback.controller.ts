import { Controller, Get, Param, ParseIntPipe, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TorrentPlaybackService } from './torrent-playback.service.js';

@Controller('playback/torrents')
export class TorrentPlaybackController {
  constructor(private readonly torrents: TorrentPlaybackService) {}

  @Get(':infoHash/:fileIdx/stream')
  stream(
    @Param('infoHash') infoHash: string,
    @Param('fileIdx', ParseIntPipe) fileIdx: number,
    @Query('tracker') trackers: string[] | string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.torrents.stream(infoHash, fileIdx, trackers, req, res);
  }
}
