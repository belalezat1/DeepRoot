import type { BackendOptions } from "../backend.js";
import { DEMO_EMAIL_ROUTING, INTERNAL_APP_CONNECTORS } from "../ingest/connectors/index.js";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readObject(env: NodeJS.ProcessEnv, name: string): Record<string, unknown> | undefined {
  if (!env[name]) return undefined;
  try {
    const value: unknown = JSON.parse(env[name]!);
    if (!object(value)) throw new Error();
    return value;
  } catch { throw new Error(`${name} must be a JSON object.`); }
}

function accountMap(value: unknown, label: string): Record<string, string> {
  if (!object(value) || Object.entries(value).some(([key, id]) => !key.trim() || key === "__proto__" || typeof id !== "string" || !id.trim())) {
    throw new Error(`${label} must map non-empty source keys to account IDs.`);
  }
  return Object.fromEntries(Object.entries(value).map(([key, id]) => [key, (id as string).trim()]));
}

/** Trusted server-owned routing only. Request bodies can never supply account mappings or ACLs. */
export function sourceConfig(env: NodeJS.ProcessEnv): Pick<BackendOptions, "emailRouting" | "connectors"> {
  const mailboxConfig = readObject(env, "EMAIL_ROUTING_JSON");
  const policies = readObject(env, "CONNECTOR_POLICIES_JSON");
  const appConfig = readObject(env, "CONNECTOR_ACCOUNT_MAPS_JSON");
  const mailboxes = mailboxConfig === undefined ? DEMO_EMAIL_ROUTING.mailboxes : accountMap(mailboxConfig, "EMAIL_ROUTING_JSON");
  if (Object.keys(mailboxes).some((address) => address !== address.toLowerCase().trim() || !/^[^\s@<>]+@[^\s@<>]+$/.test(address))) {
    throw new Error("EMAIL_ROUTING_JSON keys must be lowercase mailbox addresses.");
  }
  const known = new Set(INTERNAL_APP_CONNECTORS.map((c) => c.appId));
  if (appConfig && Object.keys(appConfig).some((id) => !known.has(id))) throw new Error("CONNECTOR_ACCOUNT_MAPS_JSON contains an unregistered connector.");
  const policyFor = (id: string) => {
    const value = policies?.[id];
    if (value === undefined) return {};
    if (!object(value)) throw new Error("Invalid connector policy.");
    let permissions: import("../ingest/internal-app.js").InternalAppConnector["permissions"];
    let classification: import("../ingest/internal-app.js").InternalAppConnector["classification"];
    if (value.permissions !== undefined) {
      const p = value.permissions;
      if (!object(p) || typeof p.path !== "string" || !p.path.trim()) throw new Error("Invalid permission mapping.");
      permissions = { path: p.path, users: accountMap(p.users, "connector permission users") };
    }
    if (value.classification !== undefined) {
      const c = value.classification;
      if (!object(c) || typeof c.path !== "string" || !c.path.trim() || !Array.isArray(c.deliveryValues) || !c.deliveryValues.length || c.deliveryValues.some(v => typeof v !== "string")) throw new Error("Invalid classification mapping.");
      classification = { path: c.path, deliveryValues: c.deliveryValues as string[] };
    }
    return { permissions, classification };
  };
  if (policies && Object.keys(policies).some(id => !known.has(id))) throw new Error("Unregistered connector policy.");
  return {
    emailRouting: { mailboxes },
    connectors: INTERNAL_APP_CONNECTORS.map((connector) => ({
      ...connector,
      ...policyFor(connector.appId),
      // Supplying a configuration switches all connectors away from fixture routing. Unlisted apps are disabled.
      accounts: appConfig === undefined ? connector.accounts : accountMap(appConfig[connector.appId] ?? {}, `CONNECTOR_ACCOUNT_MAPS_JSON.${connector.appId}`),
    })),
  };
}
