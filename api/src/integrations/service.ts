import { timingSafeEqual } from "node:crypto";
import { DEMO_APP_EXPORTS } from "@deeproot/demo";
import type { Account, DemoAppRecord, IntegrationStatus, IntegrationsResponse } from "@deeproot/shared";
import { authorizeAccount, notFound, requireUser, type AccountDirectory, type SignedInUser } from "../access.js";
import { assertDeliveryContent, accountTeamSources } from "../dataPolicy.js";
import { ApiFailure, toErrorResult, type HandlerResult } from "../errors.js";
import { getPath, ingestInternalAppRecords, type InternalAppConnector } from "../ingest/internal-app.js";
import type { SourceSearch, SourceWriter } from "../store/sources.js";
import { sourceVersion } from "../store/publicSources.js";
import type { IntegrationConfig } from "./config.js";
import type { IntegrationStore } from "./store.js";
import { safeId } from "../ingest/text.js";
import { dateIsCited } from "../agent/findings.js";

type Input = { user: SignedInUser | null; accountId: string; appId: string };
export function createIntegrationService(deps: { accounts: AccountDirectory; connectors: InternalAppConnector[]; sources: SourceSearch & SourceWriter; store: IntegrationStore; config: IntegrationConfig }) {
  const pending = new Map<string, Promise<IntegrationStatus>>();
  const edits = new Map<string, Promise<unknown>>();
  const connector = (id: string) => { const c = deps.connectors.find(c => c.appId === id); if (!c) throw notFound(); return c; };
  const demo = (accountId: string) => { if (!deps.config.demoEnabled || !deps.config.demoAccounts.includes(accountId)) throw notFound(); };
  const rawKey = (appId: string) => `sample-${appId}`;
  const receiptKey = (appId: string) => `sync-${appId}`;
  const records = async (account: Account, c: InternalAppConnector) => {
    const saved = await deps.store.get<DemoAppRecord[]>(account.id, rawKey(c.appId));
    if (saved) return saved;
    // Fixture-backed initial upstream state, independent of the normalized source store.
    return (DEMO_APP_EXPORTS[c.appId] ?? []).filter(r => c.accounts[String(getPath(r, c.fields.customerKey))] === account.id).map(raw => ({ id: String(getPath(raw, c.fields.id)), revision: 0, raw: structuredClone(raw as Record<string, unknown>) }));
  };
  const status = async (account: Account, c: InternalAppConnector): Promise<IntegrationStatus> => {
    const stored = await deps.store.get<IntegrationStatus & { indexedSourceIds?: string[] }>(account.id, receiptKey(c.appId));
    const { indexedSourceIds: _private, ...rest } = stored ?? {};
    const saved = rest as Partial<IntegrationStatus>;
    const configured = !!deps.config.http[c.appId] && Object.values(c.accounts).includes(account.id) && (!deps.config.http[c.appId]!.sample || deps.config.demoAccounts.includes(account.id));
    return { ...(saved ?? {}), appId: c.appId, name: c.appName, sample: deps.config.http[c.appId]?.sample ?? false, configured, accessMode: c.permissions ? "source" : "account", state: configured ? saved?.state ?? "ready" : "not_configured" };
  };
  return {
    async list(input: { user: SignedInUser | null; accountId: string }): Promise<HandlerResult<IntegrationsResponse>> {
      try { const user = requireUser(input.user); const account = await authorizeAccount(user, input.accountId, deps.accounts);
        return { status: 200, body: { integrations: await Promise.all(deps.connectors.map(c => status(account, c))), demoAppsEnabled: deps.config.demoEnabled && deps.config.demoAccounts.includes(account.id) } };
      } catch (err) { return toErrorResult(err); }
    },
    async demoRecords(input: Input): Promise<HandlerResult<{ records: DemoAppRecord[] }>> {
      try { const user = requireUser(input.user); const account = await authorizeAccount(user, input.accountId, deps.accounts); demo(account.id);
        return { status: 200, body: { records: await records(account, connector(input.appId)) } };
      } catch (err) { return toErrorResult(err); }
    },
    async edit(input: Input & { recordId: string; body: unknown }): Promise<HandlerResult<{ record: DemoAppRecord }>> {
      try {
        const user = requireUser(input.user); const account = await authorizeAccount(user, input.accountId, deps.accounts); demo(account.id); const c = connector(input.appId);
        const key = JSON.stringify([account.id, c.appId]);
        const previous = edits.get(key) ?? Promise.resolve();
        const work = previous.catch(() => undefined).then(async () => {
          const b = input.body as { revision?: unknown; changes?: Record<string, unknown> } | null;
          const list = await records(account, c); const record = list.find(r => r.id === input.recordId);
          if (!record) throw notFound();
          if (b?.revision !== record.revision) throw new ApiFailure("BAD_REQUEST", "This record changed. Reload it before saving.");
          if (!b.changes || typeof b.changes !== "object" || Array.isArray(b.changes)) throw new ApiFailure("BAD_REQUEST", "Provide record changes.");
          const permitted = c.appId === "impl-tracker" ? ["status", "assignee", "due_date", "go_live", "notes"] : ["state", "missing", "employees_affected", "comment"];
          for (const [field, value] of Object.entries(b.changes)) {
            if (!permitted.includes(field)) throw new ApiFailure("BAD_REQUEST", "This field cannot be edited.");
            if (field === "employees_affected") { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1000000) throw new ApiFailure("BAD_REQUEST", "Affected count must be a non-negative whole number."); }
            else if (field === "missing") { if (!Array.isArray(value) || value.some(v => typeof v !== "string" || v.length > 200)) throw new ApiFailure("BAD_REQUEST", "Missing items must be a list of short text."); }
            else if (typeof value !== "string" || value.length > 1000) throw new ApiFailure("BAD_REQUEST", "Use text of at most 1,000 characters.");
            if (["due_date", "go_live"].includes(field) && !dateIsCited(String(value), [{ sourceId: "validation", quote: String(value) }])) throw new ApiFailure("BAD_REQUEST", "Use a valid YYYY-MM-DD date.");
            if (field === "status" && !["Blocked", "In progress", "Complete"].includes(String(value))) throw new ApiFailure("BAD_REQUEST", "Invalid tracker status.");
            if (field === "state" && !["INCOMPLETE", "IN_PROGRESS", "COMPLETE"].includes(String(value))) throw new ApiFailure("BAD_REQUEST", "Invalid configuration status.");
          }
          assertDeliveryContent(JSON.stringify(b.changes));
          const updated = await deps.store.update<DemoAppRecord[]>(account.id, rawKey(c.appId), current => {
            const rows = current ?? list; const target = rows.find(r => r.id === input.recordId);
            if (!target || target.revision !== b.revision) throw new ApiFailure("BAD_REQUEST", "This record changed. Reload it before saving.");
            Object.assign(target.raw, b.changes, c.appId === "impl-tracker" ? { updated_at: new Date().toISOString(), updated_by: "Demo account team" } : { last_modified_ms: Date.now(), modified_by: { name: "Demo account team" } });
            target.revision++; return rows;
          });
          return updated.find(r => r.id === input.recordId)!;
        });
        edits.set(key, work);
        try { return { status: 200, body: { record: await work } }; } finally { if (edits.get(key) === work) edits.delete(key); }
      } catch (err) { return toErrorResult(err); }
    },
    async create(input: Input & { body: unknown }): Promise<HandlerResult<{ record: DemoAppRecord }>> {
      try {
        const user = requireUser(input.user); const account = await authorizeAccount(user, input.accountId, deps.accounts); demo(account.id); const c = connector(input.appId);
        const body = input.body as { title?: unknown } | null;
        if (typeof body?.title !== "string" || !body.title.trim() || body.title.length > 200) throw new ApiFailure("BAD_REQUEST", "Use a title of 1–200 characters.");
        assertDeliveryContent(body.title);
        const customerKey = Object.entries(c.accounts).find(([, id]) => id === account.id)?.[0]; if (!customerKey) throw notFound();
        const key = JSON.stringify([account.id, c.appId]); if (edits.has(key)) throw new ApiFailure("BAD_REQUEST", "Another edit is in progress. Retry.");
        const id = c.appId === "impl-tracker" ? `DEMO-${crypto.randomUUID()}` : String(Date.now());
        const raw = c.appId === "impl-tracker" ? { ticket_id: id, customer: { code: customerKey }, summary: body.title.trim(), status: "Blocked", assignee: null, due_date: new Date().toISOString().slice(0, 10), go_live: new Date().toISOString().slice(0, 10), notes: "New delivery dependency", updated_by: "Demo account team", updated_at: new Date().toISOString() } : { cfg_id: id, client_ref: customerKey, setting: body.title.trim(), area: "Implementation readiness", state: "INCOMPLETE", missing: ["Readiness confirmation"], employees_affected: 0, last_modified_ms: Date.now(), modified_by: { name: "Demo account team" } };
        const record = { id, revision: 0, raw }; const list = await records(account, c); await deps.store.update<DemoAppRecord[]>(account.id, rawKey(c.appId), current => { const rows = current ?? list; if (rows.length >= 200 || rows.some(r => r.id === id)) throw new ApiFailure("BAD_REQUEST", "The sample tool is full. Remove a record first."); return [...rows, record]; });
        return { status: 201, body: { record } };
      } catch (err) { return toErrorResult(err); }
    },
    async delete(input: Input & { recordId: string; body: unknown }): Promise<HandlerResult<{ deleted: boolean }>> {
      try {
        const user = requireUser(input.user); const account = await authorizeAccount(user, input.accountId, deps.accounts); demo(account.id); const c = connector(input.appId);
        if (edits.has(JSON.stringify([account.id, c.appId]))) throw new ApiFailure("BAD_REQUEST", "Another edit is in progress. Retry.");
        const list = await records(account, c); const record = list.find(r => r.id === input.recordId);
        if (!record) throw notFound(); if ((input.body as { revision?: unknown })?.revision !== record.revision) throw new ApiFailure("BAD_REQUEST", "Reload the changed record before deleting.");
        await deps.store.update<DemoAppRecord[]>(account.id, rawKey(c.appId), current => { const rows = current ?? list; const target = rows.find(r => r.id === record.id); if (!target || target.revision !== record.revision) throw new ApiFailure("BAD_REQUEST", "Reload the changed record before deleting."); return rows.filter(r => r.id !== record.id); }); return { status: 200, body: { deleted: true } };
      } catch (err) { return toErrorResult(err); }
    },
    async reset(input: Input): Promise<HandlerResult<{ records: DemoAppRecord[] }>> {
      try { const user = requireUser(input.user); const account = await authorizeAccount(user, input.accountId, deps.accounts); demo(account.id); const c = connector(input.appId);
        if (edits.has(JSON.stringify([account.id, c.appId]))) throw new ApiFailure("BAD_REQUEST", "A sample edit is in progress. Retry reset.");
        const list = (DEMO_APP_EXPORTS[c.appId] ?? []).filter(r => c.accounts[String(getPath(r, c.fields.customerKey))] === account.id).map(raw => ({ id: String(getPath(raw, c.fields.id)), revision: Date.now(), raw: { ...(raw as Record<string, unknown>), ...(c.appId === "impl-tracker" ? { updated_at: new Date().toISOString() } : { last_modified_ms: Date.now() }) } }));
        const updated = await deps.store.update<DemoAppRecord[]>(account.id, rawKey(c.appId), current => list.map(r => ({ ...r, revision: Math.max(r.revision, ...((current ?? []).map(v => v.revision + 1))) }))); return { status: 200, body: { records: updated } };
      } catch (err) { return toErrorResult(err); }
    },
    async export(input: { appId: string; customerKey: string; token: string }): Promise<HandlerResult<{ records: Record<string, unknown>[] }>> {
      try {
        const expected = deps.config.demoToken;
        if (!deps.config.demoEnabled || !expected || Buffer.byteLength(input.token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(input.token), Buffer.from(expected))) throw notFound();
        const c = connector(input.appId); const accountId = c.accounts[input.customerKey]; if (!accountId) throw notFound(); demo(accountId);
        const account = await deps.accounts.getAccount(accountId); if (!account) throw notFound();
        return { status: 200, body: { records: (await records(account, c)).map(r => r.raw) } };
      } catch (err) { return toErrorResult(err); }
    },
    async sync(input: Input): Promise<HandlerResult<IntegrationStatus>> {
      try {
        const user = requireUser(input.user); const account = await authorizeAccount(user, input.accountId, deps.accounts); const c = connector(input.appId);
        const old = await status(account, c); const http = deps.config.http[c.appId];
        if (!old.configured || !http) throw new ApiFailure("INTEGRATION_UNAVAILABLE", "This connector is not configured.");
        const key = JSON.stringify([account.id, c.appId]); let work = pending.get(key);
        if (!work) {
          work = (async () => {
            const deadline = AbortSignal.timeout(40_000);
            try {
              const keys = Object.entries(c.accounts).filter(([, id]) => id === account.id).map(([key]) => key);
              const raw: unknown[] = [];
              for (const customerKey of keys) {
                const url = new URL(http.url); url.searchParams.set("customerKey", customerKey);
                const response = await fetch(url, { headers: { Authorization: `Bearer ${http.token}` }, redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]) });
                if (!response.ok) throw new Error("Upstream failed");
                const body = await response.text(); if (body.length > 1000000) throw new Error("Export too large");
                const parsed = JSON.parse(body); if (!Array.isArray(parsed.records) || parsed.records.length > 200) throw new Error("Invalid export"); raw.push(...parsed.records);
              }
              if (raw.length > 200) throw new Error("Export too large");
              const result = ingestInternalAppRecords(c, raw, [account]);
              const safe = accountTeamSources(result.records); const rejected = result.rejected.length + result.records.length - safe.length;
              const changedSourceIds: string[] = [];
              // Eight writes maximum. Never record a successful receipt before all index writes finish.
              let cursor = 0;
              await Promise.all(Array.from({ length: Math.min(8, safe.length) }, async () => {
                while (cursor < safe.length) { deadline.throwIfAborted(); const source = safe[cursor++]!; const before = await deps.sources.get?.(account.id, source.id);
                  await deps.sources.save(source); const after = await deps.sources.get?.(account.id, source.id) ?? source;
                  if (!before || sourceVersion(before) !== sourceVersion(after)) changedSourceIds.push(source.id);
                }
              }));
              const previous = await deps.store.get<IntegrationStatus & { indexedSourceIds?: string[] }>(account.id, receiptKey(c.appId));
              const present = new Set(safe.map(s => s.id));
              const initialIds = http.sample ? (DEMO_APP_EXPORTS[c.appId] ?? []).filter(r => c.accounts[String(getPath(r, c.fields.customerKey))] === account.id).map(r => safeId(account.id, c.appId, String(getPath(r, c.fields.id)))) : [];
              const removed = new Set((previous?.indexedSourceIds ?? initialIds).filter(id => !present.has(id)));
              for (const rejection of result.rejected) if (rejection.recordId && raw.some(r => String(getPath(r, c.fields.id)) === rejection.recordId && c.accounts[String(getPath(r, c.fields.customerKey))] === account.id)) removed.add(safeId(account.id, c.appId, rejection.recordId));
              for (const id of removed) { if (!deps.sources.remove) throw new Error("Source removal unavailable"); await deps.sources.remove(account.id, id); changedSourceIds.push(id); }
              const receipt: IntegrationStatus = { ...old, state: rejected ? "failed" : "synced", accepted: safe.length, rejected, changedSourceIds,
                ...(rejected ? { error: "Some upstream records were rejected. Review the connector mapping and source permissions." } : { lastSuccessfulSync: new Date().toISOString(), error: undefined }) };
              await deps.store.put(account.id, receiptKey(c.appId), { ...receipt, indexedSourceIds: safe.map(s => s.id) }); return receipt;
            } catch {
              const receipt: IntegrationStatus = { ...old, state: "failed", error: "Sync failed. Check the upstream connection and indexing, then retry." };
              const prior = await deps.store.get<IntegrationStatus & { indexedSourceIds?: string[] }>(account.id, receiptKey(c.appId));
              await deps.store.put(account.id, receiptKey(c.appId), { ...receipt, indexedSourceIds: prior?.indexedSourceIds ?? [] }); return receipt;
            }
          })(); pending.set(key, work);
        }
        try { const receipt = await work; return { status: receipt.state === "failed" ? 503 : 200, body: receipt }; }
        finally { if (pending.get(key) === work) pending.delete(key); }
      } catch (err) { return toErrorResult(err); }
    },
  };
}
