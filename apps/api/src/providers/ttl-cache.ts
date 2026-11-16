/** Cache em memória com TTL e deduplicação de chamadas simultâneas. */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expires: number }>();
  private readonly pending = new Map<string, Promise<T>>();

  constructor(private readonly ttlMs: number) {}

  async getOrSet(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const request = loader().then((value) => {
      this.store.set(key, { value, expires: Date.now() + this.ttlMs });
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
