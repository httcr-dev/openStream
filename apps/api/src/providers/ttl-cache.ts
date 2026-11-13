/** Cache em memória com TTL (poupa a cota das APIs externas). */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expires: number }>();

  constructor(private readonly ttlMs: number) {}

  async getOrSet(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await loader();
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }
}
