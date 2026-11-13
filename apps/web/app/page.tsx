import Link from 'next/link';
import { api, type CatalogItem } from '@/lib/api';

/**
 * Busca renderizada no servidor: o formulário é um GET comum para `/?q=...`.
 * Funciona mesmo sem JavaScript no cliente e gera uma URL compartilhável.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const term = q.trim();

  let items: CatalogItem[] | null = null;
  let error: string | null = null;
  if (term) {
    try {
      items = await api.search(term);
    } catch (e) {
      error =
        e instanceof Error && e.message !== 'fetch failed'
          ? e.message
          : 'Não consegui falar com a API. Ela está rodando em http://localhost:3000?';
    }
  }

  return (
    <>
      <form className="search" action="/" method="get">
        <input name="q" defaultValue={q} placeholder="Buscar filmes e séries…" autoFocus />
        <button type="submit">Buscar</button>
      </form>

      {error && <p className="err">{error}</p>}
      {items && items.length === 0 && <p className="muted">Nada encontrado para “{term}”.</p>}

      <div className="grid">
        {items?.map((it) => (
          <Link key={it.id} href={`/title/${it.kind}/${it.tmdbId}`} className="card">
            {it.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.posterUrl} alt={it.title} loading="lazy" />
            ) : (
              <div className="noposter">Sem poster</div>
            )}
            <div className="meta">
              <div className="t">{it.title}</div>
              <div className="s">
                {it.kind === 'movie' ? 'Filme' : 'Série'}
                {it.year ? ` · ${it.year}` : ''}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
