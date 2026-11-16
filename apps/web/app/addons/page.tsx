'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Addon = {
  id: string;
  name: string;
  description?: string;
  status: 'ready' | 'error';
  error?: string;
  resources: unknown[];
  health?: { requests: number; successRate: number | null; averageLatencyMs: number | null; score: number };
};

export default function AddonsPage() {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.addons().then(setAddons).catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <>
      <p><Link href="/" className="muted">← Voltar à busca</Link></p>
      <h1>Addons</h1>
      <p className="muted">O OpenStream carrega os manifests configurados no servidor e consulta automaticamente os addons compatíveis com cada título e episódio.</p>
      {error && <p className="err">{error}</p>}
      {!error && addons.length === 0 && <p className="muted">Nenhum addon configurado. Adicione URLs de manifest em STREMIO_ADDON_URLS no arquivo .env e reinicie a API.</p>}
      {addons.map((addon) => (
        <section className="panel" key={addon.id}>
          <div className="row">
            <strong>{addon.name}</strong>
            <span className="badge">{addon.status === 'ready' ? 'Carregado' : 'Falha no manifest'}</span>
          </div>
          {addon.description && <p className="muted">{addon.description}</p>}
          <div className="muted">Recursos: {addon.resources.map((resource) => typeof resource === 'string' ? resource : JSON.stringify(resource)).join(', ') || '—'}</div>
          {addon.health && <div className="muted">Consultas: {addon.health.requests} · Taxa de resposta: {addon.health.successRate === null ? 'sem dados' : `${Math.round(addon.health.successRate * 100)}%`} · Latência média: {addon.health.averageLatencyMs === null ? '—' : `${addon.health.averageLatencyMs} ms`}</div>}
          {addon.error && <p className="err">{addon.error}</p>}
        </section>
      ))}
    </>
  );
}
