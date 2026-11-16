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

Nesta primeira versão são aceitos streams HTTP(S) diretos e IDs de vídeo do YouTube para embed oficial. Torrents, debrid, `externalUrl` e streams que exigem cabeçalhos especiais ainda não são suportados pelo player web. A lista de manifests é configurada uma única vez no servidor, não por usuário. A descoberta automática seleciona todos os addons compatíveis dessa lista. O ranking adaptativo considera taxa de resposta e latência observadas; ainda não há integração com um diretório global para importar popularidade.

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
