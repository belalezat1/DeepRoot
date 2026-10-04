import type { Container } from "@azure/cosmos";

export interface IntegrationStore {
  get<T>(accountId: string, id: string): Promise<T | null>;
  update<T>(accountId: string, id: string, change: (value: T | null) => T): Promise<T>;
  put<T>(accountId: string, id: string, value: T): Promise<void>;
}
export class InMemoryIntegrationStore implements IntegrationStore {
  private values = new Map<string, unknown>();
  async get<T>(accountId: string, id: string): Promise<T | null> { return structuredClone(this.values.get(JSON.stringify([accountId, id])) as T ?? null); }
  async update<T>(accountId: string, id: string, change: (value: T | null) => T): Promise<T> { const key = JSON.stringify([accountId, id]); const value = change(structuredClone(this.values.get(key) as T ?? null)); this.values.set(key, structuredClone(value)); return structuredClone(value); }
  async put<T>(accountId: string, id: string, value: T): Promise<void> { this.values.set(JSON.stringify([accountId, id]), structuredClone(value)); }
}
export class CosmosIntegrationStore implements IntegrationStore {
  constructor(private container: Container) {}
  async get<T>(accountId: string, id: string): Promise<T | null> {
    const { resource } = await this.container.item(id, accountId).read<{ value: T }>();
    return resource?.value ?? null;
  }
  async update<T>(accountId: string, id: string, change: (value: T | null) => T): Promise<T> {
    const item = this.container.item(id, accountId);
    for (let i = 0; i < 8; i++) {
      const { resource } = await item.read<{ _etag: string; value: T }>();
      const value = change(resource?.value ?? null); const doc = { id, accountId, value };
      try { if (resource) await item.replace(doc, { accessCondition: { type: "IfMatch", condition: resource._etag } }); else await this.container.items.create(doc); return value; }
      catch (err) { if (![409, 412].includes((err as { code: number }).code)) throw err; }
    }
    throw new Error("Sample record contention; reload and retry.");
  }
  async put<T>(accountId: string, id: string, value: T): Promise<void> { await this.container.items.upsert({ id, accountId, value }); }
}
