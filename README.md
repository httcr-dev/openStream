# OpenStream

Agregador pessoal de catálogo e reprodução. O TMDB identifica filmes e séries; providers e addons independentes procuram streams para o conteúdo específico solicitado.

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces |
| API | NestJS 12 + TypeScript — porta 3000, prefixo `/api/v1` |
| Web | Next.js 16 + React 19 — porta 3001 |
| Catálogo | TMDB |
| Addons | Protocolo Stremio (manifest, stream) |
| P2P | WebTorrent no backend, com entrega HTTP/Range ao player |
| Infra local | PostgreSQL opcional (a API ainda não o utiliza) |

## Executar localmente

```bash
cp .env.example .env
# Preencha TMDB_READ_TOKEN
pnpm install
pnpm dev:api
pnpm dev:web
```

PostgreSQL é opcional e pode ser iniciado com `pnpm infra:up`. O backend funciona sem servidor de mídia local.

## Addons Stremio e política de admissão

A descoberta pública fica **desativada por padrão**. Para habilitá-la, defina `STREMIO_ADDON_DISCOVERY_ENABLED=true`; mesmo assim, manifests só são carregados quando o ID consta em `STREMIO_ADDON_ALLOWED_IDS`. A configuração manual usa `STREMIO_ADDON_URLS`, também sujeita à allowlist. Todas as URLs são verificadas contra destinos locais/privados para reduzir risco de SSRF.

Além da allowlist, cada addon precisa de uma declaração explícita em `STREMIO_ADDON_AUTHORIZATIONS`, um JSON indexado pelo ID do manifest. Exemplo para uma fonte licenciada:

```env
STREMIO_ADDON_URLS=https://my-authorized-addon.example/manifest.json
STREMIO_ADDON_ALLOWED_IDS=org.example.my-addon
STREMIO_ADDON_AUTHORIZATIONS={"org.example.my-addon":{"status":"licensed","licenseUrl":"https://example.org/license"}}
```

Os status aceitos são `public-domain`, `creative-commons`, `licensed` e `user-owned`. Para `user-owned`, a URL de licença pode ser omitida. Essa declaração é uma configuração do operador, não uma auditoria jurídica automática. Sem allowlist e autorização, o addon não entrega fontes ao player.

A compatibilidade exige que o manifest declare recurso `stream`, tipo de mídia e prefixo de ID compatíveis. Respostas com erros HTTP entram em cooldown: 403, 404/410, 429, 5xx e falhas de conexão têm janelas distintas. Erros por conteúdo não devem ser confundidos com indisponibilidade geral do provedor.

Fontes externas só entram no seletor quando forem nativas HTTP/HLS, tiverem autorização declarada e a verificação confirmar que a URL retorna mídia ou playlist HLS válida. `unknown` não é disponibilidade: embeds e P2P sem verificação não entram como opções automáticas. O failover aplica a mesma política para não substituir uma falha por outra fonte não verificada.

## Normalização e seleção de fontes\n\nCada fonte mantém seu destino original e pode incluir `release` com metadados normalizados. O deduplicador usa título normalizado, ano, episódio e atributos técnicos para agrupar releases equivalentes de addons diferentes; quando há equivalência, preserva a fonte melhor ranqueada. Fontes sem metadados suficientes continuam disponíveis e são deduplicadas pelo destino. O seletor apresenta resolução, tipo de release, codec, áudio, idiomas de legenda, tamanho, seeders, transporte e estado da verificação.\n\nO ranking é heurístico e determinístico, não uma garantia de qualidade real: seeders variam, `unknown` significa que não houve prova de disponibilidade e codecs podem não ser suportados pelo navegador.\n\n## Reprodução P2P

O backend usa WebTorrent para abrir o torrent sob demanda e disponibilizar o arquivo selecionado por HTTP. O player web continua usando o elemento `<video>` normal; o endpoint suporta requisições `Range`, necessárias para iniciar a reprodução e permitir seek.

- Endpoint: `GET /api/v1/playback/torrents/:infoHash/:fileIdx/stream`
- Use `fileIdx=-1` quando o addon não informar um índice; o backend seleciona o maior arquivo de vídeo.
- Trackers são passados como query params repetidos `tracker`.
- Upload P2P está desabilitado no cliente; o backend baixa os dados necessários para reproduzir.
- Torrents inativos são removidos após 30 minutos. Até 5 torrents podem permanecer ativos simultaneamente.
- O diretório de armazenamento pode ser alterado por `OPENSTREAM_TORRENT_PATH` (padrão: `/tmp/openstream-torrents`).

A reprodução depende de metadados e peers disponíveis. Formato e codecs continuam sujeitos ao suporte do navegador.

## Providers

- **Stremio Addons**: adaptador de manifests e recurso `stream`.
- **Internet Archive**: busca de filmes com correspondência exata de título; não retorna resultados para séries enquanto não houver resolução confiável de episódios.

YouTube Search e PeerTube Search foram retirados do registro automático porque uma busca textual não comprova que o resultado seja o filme ou episódio solicitado. Poderão voltar como integrações específicas quando tiverem identificação precisa.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/health` | Saúde da API |
| GET | `/api/v1/catalog/search?q=` | Busca de filmes e séries no TMDB |
| GET | `/api/v1/catalog/movie/:id` | Detalhes do filme |
| GET | `/api/v1/catalog/series/:id` | Detalhes da série e temporadas |
| GET | `/api/v1/catalog/series/:id/seasons/:season` | Episódios da temporada |
| GET | `/api/v1/playback/sources?id=tmdb:series:123&season=1&episode=2` | Fontes para episódio específico |
| POST | `/api/v1/playback/failover` | Registra falha e retorna próxima fonte ainda não tentada |
| GET | `/api/v1/playback/runtime/stats` | Métricas agregadas de falhas e failovers em runtime |
| GET | `/api/v1/playback/torrents/:infoHash/:fileIdx/stream` | Stream HTTP de um arquivo torrent |
| GET | `/api/v1/providers` | Providers ativos |
| GET | `/api/v1/addons` | Addons carregados e estado dos manifests |
| GET | `/api/v1/addons/stats` | Contadores de descoberta, allowlist e saúde |

## Testes

```bash
pnpm --filter @openstream/api test
```

O comando compila a API e executa os testes unitários com o test runner nativo do Node.js.

## Estado e limitações desta versão

- O backend não depende de servidor de mídia local.
- O resolver exige temporada e episódio ao pesquisar uma série.
- A continuidade prioriza o mesmo addon/provider ao consultar o próximo episódio.
- A página de reprodução oferece navegação para episódio anterior e próximo, inclusive entre temporadas.
- Falhas de reprodução HTTP/HLS/torrent no player disparam busca automática por outra fonte; fontes já tentadas não são repetidas na mesma sessão.
- Métricas de falha/failover ficam em memória por até uma hora e são limitadas às 500 fontes mais recentes; reiniciar a API zera esses dados.
- Falhas internas de iframes/embed não podem ser detectadas de forma confiável pelo navegador por causa do isolamento entre origens; nesses casos, a troca manual de fonte continua disponível.
- A descoberta global de addons é automática, com configuração manual opcional para instâncias personalizadas.
- A autorização declarada é obrigatória para admitir fontes externas; a configuração representa a responsabilidade do operador e não substitui verificação jurídica.
