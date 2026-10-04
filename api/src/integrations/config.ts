export type HttpConnector = { url: string; token: string; sample: boolean };
export type IntegrationConfig = { demoEnabled: boolean; demoAccounts: string[]; demoToken: string; http: Record<string, HttpConnector> };
export function integrationConfig(env: NodeJS.ProcessEnv): IntegrationConfig {
  const demoEnabled = env.ENABLE_DEMO_APPS === "true";
  const demoToken = env.DEMO_APPS_TOKEN ?? "";
  if (demoEnabled && demoToken.length < 16) throw new Error("Enabled sample apps require DEMO_APPS_TOKEN with at least 16 characters.");
  const demoAccounts = (env.DEMO_APP_ACCOUNT_IDS ?? "northstar").split(",").filter(Boolean);
  if (demoAccounts.some(id => !["northstar", "betaco"].includes(id))) throw new Error("Sample apps can only use fictional fixture accounts.");
  const http: Record<string, HttpConnector> = {};
  if (demoEnabled) for (const id of ["impl-tracker", "payroll-config"]) http[id] = { url: `${env.DEMO_APPS_BASE_URL ?? "http://localhost:7071"}/api/demo-apps/${id}/export`, token: demoToken, sample: true };
  const configured = JSON.parse(env.CONNECTOR_HTTP_JSON ?? "{}");
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error("CONNECTOR_HTTP_JSON must be an object.");
  for (const [id, raw] of Object.entries(configured)) {
    const value = raw as { url?: unknown; tokenEnv?: unknown };
    if (!["impl-tracker", "payroll-config"].includes(id) || typeof value.url !== "string" || typeof value.tokenEnv !== "string" || !env[value.tokenEnv]) throw new Error("Invalid HTTP connector configuration.");
    http[id] = { url: value.url, token: env[value.tokenEnv]!, sample: false };
  }
  for (const value of Object.values(http)) {
    const url = new URL(value.url);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("Connector URLs require HTTPS or local loopback HTTP, without embedded credentials.");
  }
  return { demoEnabled, demoAccounts, demoToken, http };
}
