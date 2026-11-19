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

## Addons Stremio

Configure uma lista de URLs de manifests em `STREMIO_ADDON_URLS`, separadas por vírgula. O OpenStream carrega os manifests ao iniciar, identifica addons com recurso `stream` e consulta automaticamente os que declaram compatibilidade com o tipo e identificador do conteúdo.

Para séries, a consulta usa o IMDb ID e o identificador de episódio no formato `tt...:temporada:episódio`. Isso faz com que o addon receba o episódio específico, em vez de uma busca textual genérica pelo nome da série.

São aceitos streams HTTP(S) diretos, IDs de vídeo do YouTube para embed oficial e candidatos torrent. No caso de torrents, o adaptador preserva o info hash, índice do arquivo e trackers declarados pelo addon.

Para Comet/ElfHosted, use a URL de manifest gerada pela página `/configure`. O manifest público sem configuração pode responder HTTP 403 no endpoint de streams. Addons que retornam 403 ficam em cooldown por 15 minutos para evitar chamadas e logs repetitivos; os demais addons continuam sendo consultados.

A lista de manifests é configurada uma única vez no servidor, não por usuário. A descoberta automática seleciona todos os addons compatíveis dessa lista. O ranking adaptativo considera taxa de resposta e latência observadas; ainda não há integração com um diretório global para importar popularidade.

## Reprodução P2P

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
| GET | `/api/v1/playback/torrents/:infoHash/:fileIdx/stream` | Stream HTTP de um arquivo torrent |
| GET | `/api/v1/providers` | Providers ativos |
| GET | `/api/v1/addons` | Addons carregados e estado dos manifests |

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
- A seleção de addons é automática entre os manifests configurados; a descoberta global/popularidade do diretório será uma etapa posterior.
- A verificação de direitos/autorização foi deliberadamente adiada para uma fase posterior, conforme a prioridade atual de validar o funcionamento local.
