import { Injectable } from '@nestjs/common';
import { isSafeAddonUrl } from './stremio-addons/addon-registry.service.js';

/** Reutiliza a política de URL pública já aplicada à descoberta de addons. */
@Injectable()
export class SourceUrlSafetyService {
  isSafe(value: string): Promise<boolean> {
    return isSafeAddonUrl(value);
  }
}
