import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProviderIds?: Record<string, string>;
  MediaSources?: { Id: string; Container?: string }[];
}

interface Session {
  token: string;
  userId: string;
}

const CLIENT_AUTH =
  'MediaBrowser Client="OpenStream", Device="OpenStream API", DeviceId="openstream-api", Version="0.1.0"';

/** Cliente HTTP mínimo do Jellyfin: autenticação com cache + chamadas autenticadas. */
@Injectable()
export class JellyfinClient {
  private readonly logger = new Logger(JellyfinClient.name);
  private session?: Session;
  private pendingLogin?: Promise<Session>;

  constructor(private readonly config: ConfigService) {}

  get baseUrl(): string {
    return (this.config.get<string>('JELLYFIN_URL') ?? 'http://localhost:8096').replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('JELLYFIN_USERNAME') && this.config.get<string>('JELLYFIN_PASSWORD'),
    );
  }

  private async login(): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: CLIENT_AUTH },
      body: JSON.stringify({
        Username: this.config.get<string>('JELLYFIN_USERNAME'),
        Pw: this.config.get<string>('JELLYFIN_PASSWORD'),
      }),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Jellyfin: falha de autenticação (${res.status})`);
    }
    const data = (await res.json()) as { AccessToken: string; User: { Id: string } };
    this.logger.log('Autenticado no Jellyfin');
    return { token: data.AccessToken, userId: data.User.Id };
  }

  async getSession(force = false): Promise<Session> {
    if (this.session && !force) return this.session;
    this.pendingLogin ??= this.login().finally(() => {
      this.pendingLogin = undefined;
    });
    this.session = await this.pendingLogin;
    return this.session;
  }

  /** Header de autorização enviado ao Jellyfin (o token nunca vai ao navegador). */
  async authHeader(): Promise<string> {
    const { token } = await this.getSession();
    return `${CLIENT_AUTH}, Token="${token}"`;
  }

  /** fetch autenticado, com um retry após reautenticar em caso de 401. */
  async fetchRaw(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
    const doFetch = async () => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', await this.authHeader());
      return fetch(`${this.baseUrl}/${pathAndQuery.replace(/^\/+/, '')}`, { ...init, headers });
    };
    let res = await doFetch();
    if (res.status === 401) {
      await this.getSession(true);
      res = await doFetch();
    }
    return res;
  }

  async getJson<T>(pathAndQuery: string): Promise<T> {
    const res = await this.fetchRaw(pathAndQuery, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ServiceUnavailableException(`Jellyfin ${res.status} em ${pathAndQuery}`);
    return (await res.json()) as T;
  }

  async searchItems(term: string, type: 'Movie' | 'Series'): Promise<JellyfinItem[]> {
    const { userId } = await this.getSession();
    const qs = new URLSearchParams({
      userId,
      recursive: 'true',
      includeItemTypes: type,
      searchTerm: term,
      fields: 'ProviderIds,ProductionYear',
      limit: '50',
    });
    const data = await this.getJson<{ Items: JellyfinItem[] }>(`Items?${qs}`);
    return data.Items;
  }

  async getEpisodes(seriesId: string, season: number): Promise<JellyfinItem[]> {
    const { userId } = await this.getSession();
    const qs = new URLSearchParams({ userId, season: String(season) });
    const data = await this.getJson<{ Items: JellyfinItem[] }>(`Shows/${seriesId}/Episodes?${qs}`);
    return data.Items;
  }
}
