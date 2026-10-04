import { describe, expect, it } from "vitest";
import { sourceConfig } from "./sourceConfig.js";
import { DEMO_EMAIL_ROUTING } from "../ingest/connectors/index.js";

describe("trusted source routing", () => {
  it("keeps fixture routing by default, and allows server-owned real account mappings", () => {
    expect(sourceConfig({}).emailRouting).toEqual(DEMO_EMAIL_ROUTING);
    const config = sourceConfig({ EMAIL_ROUTING_JSON: '{"real@accounts.example.com":"real-client"}', CONNECTOR_ACCOUNT_MAPS_JSON: '{"impl-tracker":{"REAL_CODE":"real-client"}}' });
    expect(config.emailRouting?.mailboxes).toEqual({ "real@accounts.example.com": "real-client" });
    expect(config.connectors?.find((c) => c.appId === "impl-tracker")?.accounts).toEqual({ REAL_CODE: "real-client" });
    expect(config.connectors?.find((c) => c.appId === "payroll-config")?.accounts).toEqual({});
    expect(sourceConfig({}).emailRouting).toEqual(DEMO_EMAIL_ROUTING);
  });

  it.each([
    { EMAIL_ROUTING_JSON: "not json" }, { EMAIL_ROUTING_JSON: "[]" },
    { EMAIL_ROUTING_JSON: '{"Real@accounts.example.com":"real"}' },
    { EMAIL_ROUTING_JSON: '{"not an address":"real"}' },
    { EMAIL_ROUTING_JSON: '{"real@accounts.example.com":12}' },
    { CONNECTOR_ACCOUNT_MAPS_JSON: '{"unknown":{"key":"real"}}' },
    { CONNECTOR_ACCOUNT_MAPS_JSON: '{"impl-tracker":{"key":[]}}' },
  ])("fails closed on invalid routing: %j", (env) => { expect(() => sourceConfig(env)).toThrow(); });

  it("can disable every route without retaining demo account mappings", () => {
    const config = sourceConfig({ EMAIL_ROUTING_JSON: "{}", CONNECTOR_ACCOUNT_MAPS_JSON: "{}" });
    expect(config.emailRouting?.mailboxes).toEqual({});
    expect(config.connectors?.every((c) => Object.keys(c.accounts).length === 0)).toBe(true);
  });
});
