# OpenStream

Agregador pessoal: pesquisa filmes/séries (TMDB), descobre fontes **autorizadas** e reproduz dentro do app.

> O TMDB fornece só metadados. Vídeo vem de providers independentes. O OpenStream não contorna DRM,
> paywall, autenticação nem anúncios de terceiros.

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces |
| API | NestJS 12 (ESM) + TypeScript 6 — porta **3000**, prefixo `/api/v1` |
| Web | Next.js 16 + React 19 — porta **3001** |
| Mídia | Jellyfin — porta **8096** |
| Banco | PostgreSQL — porta **5432** (provisionado, ainda não usado pela API) |

## Subir

```bash
cp .env.example .env        # preencha TMDB_READ_TOKEN no mínimo
pnpm install
pnpm infra:up               # Postgres + Jellyfin
pnpm dev:api                # http://localhost:3000/api/v1/health
pnpm dev:web                # http://localhost:3001
```

1. Abra `http://localhost:8096`, conclua o assistente, crie um usuário e as bibliotecas
   `/media` (filmes) e `/shows` (séries). Ponha esse usuário em `JELLYFIN_USERNAME/PASSWORD`.
2. Para acessar do celular, ponha o IP da LAN em `PUBLIC_API_URL`, `WEB_ORIGIN` e `NEXT_PUBLIC_API_URL`.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | status |
| GET | `/catalog/search?q=` | `/search/multi` do TMDB (filmes e séries) |
| GET | `/catalog/movie/:tmdbId` · `/catalog/series/:tmdbId` | detalhes (série traz temporadas) |
| GET | `/catalog/series/:tmdbId/seasons/:n` | episódios |
| GET | `/playback/sources?id=tmdb:movie:123[&season=&episode=]` | fontes de todos os providers ativos |
| GET | `/providers` | providers e se estão ativos |
| GET | `/stream/jellyfin/*` | proxy de mídia (Range + HLS); o token do Jellyfin nunca vai ao navegador |

IDs internos: `tmdb:movie:{id}` e `tmdb:series:{id}`.

## Contrato de reprodução

```ts
type PlaybackTarget =
  | { kind: 'native'; transport: 'http' | 'hls'; url: string }   // <video> / hls.js
  | { kind: 'embed';  provider: string; embedUrl: string };      // player oficial em iframe
```

## Providers

| Provider | Player | Requer | Observações |
|---|---|---|---|
| Jellyfin | native (Direct Play + HLS) | usuário/senha | só o que está na sua biblioteca; casa por TMDB ID, com fallback por título (localizado ou original) + ano |
| YouTube | embed | `YOUTUBE_API_KEY` | só vídeos incorporáveis; `search.list` gasta 100 da cota diária de 10.000 (cache de 6h); **os anúncios do YouTube continuam** |
| PeerTube | embed | nada (SepiaSearch) | busca por título; confira o resultado antes de assistir |
| Internet Archive | embed | nada | acervo majoritariamente de domínio público |

**Os resultados de YouTube/PeerTube/Internet Archive vêm de busca por título e podem ser outro conteúdo.**
A UI mostra o título real de cada fonte para você conferir.

### Adicionar um provider

1. Crie `apps/api/src/providers/<nome>/<nome>.provider.ts` implementando `PlaybackProvider`
   (`id`, `name`, `playerKind`, `isEnabled()`, `findSources(ref)`).
2. Registre em `providers.module.ts` (lista de `providers` + `onModuleInit`).

O front não muda: ele renderiza qualquer `PlaybackTarget`.

## Estado atual

Verificado (com mocks de TMDB e Jellyfin): build da API e do web, busca, detalhe, séries/episódios,
casamento título localizado × original, Direct Play, HTTP Range (206), reescrita do HLS, proteção do
token e allowlist do proxy.

**Não verificado:** integração real com TMDB, Jellyfin real (transcodificação HLS de verdade),
YouTube, PeerTube e Internet Archive (a rede do ambiente de desenvolvimento bloqueou esses hosts),
e reprodução em navegador (o player foi só compilado).

## Fora de escopo por enquanto

Persistência no Postgres (histórico/favoritos), autenticação de usuários do OpenStream,
legendas/seleção de áudio, sessões de progresso no Jellyfin, negociação de PlaybackInfo (hoje oferece
Direct Play e HLS como duas fontes separadas).
