import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterError, postJson } from "./http.js";
import { withFallback } from "./text/fallback.js";
import { callJsonModel } from "../agent/json.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("request deadline propagation", () => {
  it("rejects a model result returned after cancellation instead of accepting its JSON", async () => {
    const controller = new AbortController();
    await expect(callJsonModel({ complete: async () => { controller.abort(); return '{"grounded":true}'; } }, "system", "user", 100, undefined, "AI", controller.signal)).rejects.toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
  });
  it("aborts retry backoff without making another HTTP attempt", async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const fetch = vi.fn(async () => new Response("throttled", { status: 429, headers: { "retry-after": "5" } })); vi.stubGlobal("fetch", fetch);
    const pending = postJson("Test", "https://example.com", {}, {}, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); await Promise.resolve(); controller.abort(); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not invoke fallback after the total request has been cancelled", async () => {
    const controller = new AbortController(); const secondary = { generateText: vi.fn() };
    const primary = { generateText: vi.fn(async () => { controller.abort(); throw new AdapterError("Unavailable", "Gemini", 429); }) };
    await expect(withFallback(primary, secondary).generateText({ messages: [], signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(secondary.generateText).not.toHaveBeenCalled();
  });
});
