// Azure Functions (v4 programming model) for the Static Web App's managed API. Each function turns an
// HTTP request into one backend call and the result into a JSON response. No product logic here.
import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { getDeps } from "./deps.js";
import { requestUser } from "./principal.js";

const user = (req: HttpRequest) => requestUser(req.headers.get("x-ms-client-principal"), process.env.DEMO_USER_ID);
const backend = () => getDeps().backend;

function json(result: HandlerResult<unknown>): HttpResponseInit {
  return { status: result.status, jsonBody: result.body, headers: { "cache-control": "no-store" } };
}

/** Invalid or missing JSON becomes undefined, which the handlers reject as BAD_REQUEST. */
async function readJson(req: HttpRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

app.http("transcribe", {
  methods: ["POST"],
  route: "meetings/transcribe",
  authLevel: "anonymous",
  handler: async (req) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json(toErrorResult(new ApiFailure("BAD_REQUEST", "Send multipart/form-data with `accountId` and `audio`.")));
    }
    const audio = form.get("audio");
    const preparedFallback = form.get("allowPreparedFallback");
    return json(
      await backend().transcribe({
        user: user(req),
        accountId: form.get("accountId"),
        audio: audio instanceof Blob ? new Uint8Array(await audio.arrayBuffer()) : audio,
        fileName: audio instanceof File && audio.name ? audio.name : undefined,
        allowPreparedFallback: preparedFallback === null ? undefined : preparedFallback === "true" ? true : preparedFallback === "false" ? false : preparedFallback,
      }),
    );
  },
});

app.http("saveMeeting", {
  methods: ["POST"],
  route: "meetings",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().saveMeeting({ user: user(req), body: await readJson(req) })),
});

app.http("ingestEmails", {
  methods: ["POST"],
  route: "ingest/emails",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().ingestEmails({ user: user(req), body: await readJson(req) })),
});

app.http("ingestAppRecords", {
  methods: ["POST"],
  route: "ingest/apps/{appId}",
  authLevel: "anonymous",
  handler: async (req) =>
    json(await backend().ingestAppRecords({ user: user(req), appId: req.params.appId ?? "", body: await readJson(req) })),
});

app.http("analyze", {
  methods: ["POST"],
  route: "agent/analyze",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().analyze({ user: user(req), body: await readJson(req) })),
});

app.http("latestAnalysis", {
  methods: ["GET"],
  route: "accounts/{id}/analysis",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().latestAnalysis({ user: user(req), accountId: req.params.id ?? "" })),
});

app.http("brief", {
  methods: ["GET"],
  route: "accounts/{id}/brief",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().brief({ user: user(req), accountId: req.params.id ?? "" })),
});

app.http("createReport", {
  methods: ["POST"],
  route: "reports",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().createReport({ user: user(req), body: await readJson(req) })),
});

app.http("getReport", {
  methods: ["GET"],
  route: "reports/{id}",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().getReport({ user: user(req), reportId: req.params.id ?? "" })),
});

app.http("createLinearIssue", {
  methods: ["POST"],
  route: "reports/{id}/linear",
  authLevel: "anonymous",
  handler: async (req) =>
    json(await backend().createLinearIssue({ user: user(req), reportId: req.params.id ?? "", body: await readJson(req) })),
});

app.http("chat", {
  methods: ["POST"],
  route: "chat",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().chat({ user: user(req), body: await readJson(req) })),
});

app.http("checkClaim", {
  methods: ["POST"],
  route: "claims/check",
  authLevel: "anonymous",
  handler: async (req) => json(await backend().checkClaim({ user: user(req), body: await readJson(req) })),
});

/** Deployment check: which backend each service uses. No data, no secrets. */
app.http("health", {
  methods: ["GET"],
  route: "health",
  authLevel: "anonymous",
  handler: async () => json({ status: 200, body: { ok: true, backends: getDeps().backends } }),
});

app.http("getSource", {
  methods: ["GET"], route: "accounts/{id}/sources/{sourceId}", authLevel: "anonymous",
  handler: async req => json(await backend().getSource({ user: user(req), accountId: req.params.id ?? "", sourceId: req.params.sourceId ?? "", reportId: req.query.get("reportId") ?? undefined, version: req.query.get("version") ?? undefined })),
});

app.http("integrations", { methods: ["GET"], route: "accounts/{id}/integrations", authLevel: "anonymous", handler: async req => json(await backend().integrations.list({ user: user(req), accountId: req.params.id ?? "" })) });
app.http("syncIntegration", { methods: ["POST"], route: "accounts/{id}/integrations/{appId}/sync", authLevel: "anonymous", handler: async req => json(await backend().integrations.sync({ user: user(req), accountId: req.params.id ?? "", appId: req.params.appId ?? "" })) });
app.http("demoRecords", { methods: ["GET"], route: "demo-apps/{appId}/accounts/{id}/records", authLevel: "anonymous", handler: async req => json(await backend().integrations.demoRecords({ user: user(req), accountId: req.params.id ?? "", appId: req.params.appId ?? "" })) });
app.http("editDemoRecord", { methods: ["PATCH"], route: "demo-apps/{appId}/accounts/{id}/records/{recordId}", authLevel: "anonymous", handler: async req => json(await backend().integrations.edit({ user: user(req), accountId: req.params.id ?? "", appId: req.params.appId ?? "", recordId: req.params.recordId ?? "", body: await readJson(req) })) });
app.http("resetDemoRecords", { methods: ["POST"], route: "demo-apps/{appId}/accounts/{id}/reset", authLevel: "anonymous", handler: async req => json(await backend().integrations.reset({ user: user(req), accountId: req.params.id ?? "", appId: req.params.appId ?? "" })) });
app.http("exportDemoRecords", { methods: ["GET"], route: "demo-apps/{appId}/export", authLevel: "anonymous", handler: async req => json(await backend().integrations.export({ appId: req.params.appId ?? "", customerKey: req.query.get("customerKey") ?? "", token: req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "" })) });

app.http("createDemoRecord", { methods: ["POST"], route: "demo-apps/{appId}/accounts/{id}/records", authLevel: "anonymous", handler: async req => json(await backend().integrations.create({ user: user(req), accountId: req.params.id ?? "", appId: req.params.appId ?? "", body: await readJson(req) })) });
app.http("deleteDemoRecord", { methods: ["DELETE"], route: "demo-apps/{appId}/accounts/{id}/records/{recordId}", authLevel: "anonymous", handler: async req => json(await backend().integrations.delete({ user: user(req), accountId: req.params.id ?? "", appId: req.params.appId ?? "", recordId: req.params.recordId ?? "", body: await readJson(req) })) });
