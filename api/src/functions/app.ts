// Azure Functions (v4 programming model) for the Static Web App's managed API. Each function turns an
// HTTP request into a handler call and the handler's result into a JSON response. No product logic here.
import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { ApiFailure, type HandlerResult, toErrorResult } from "../errors.js";
import { handleAnalyze } from "../handlers/analyze.js";
import { handleCreateLinearIssue } from "../handlers/createLinearIssue.js";
import { handleCreateReport, handleGetReport } from "../handlers/reports.js";
import { handleTranscribe } from "../handlers/transcribe.js";
import { getDeps } from "./deps.js";
import { userFromPrincipal } from "./principal.js";

const user = (req: HttpRequest) => userFromPrincipal(req.headers.get("x-ms-client-principal"));

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
    try {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new ApiFailure("BAD_REQUEST", "Send multipart/form-data with `accountId` and `audio`.");
      }
      const audio = form.get("audio");
      const body = await handleTranscribe(
        {
          userId: user(req)?.userId ?? null,
          accountId: form.get("accountId"),
          audio: audio instanceof Blob ? new Uint8Array(await audio.arrayBuffer()) : audio,
          fileName: audio instanceof File && audio.name ? audio.name : undefined,
        },
        getDeps().transcribe,
      );
      return json({ status: 200, body });
    } catch (err) {
      // handleTranscribe throws ApiFailure instead of returning a result.
      return json(toErrorResult(err));
    }
  },
});

app.http("createReport", {
  methods: ["POST"],
  route: "reports",
  authLevel: "anonymous",
  handler: async (req) => json(await handleCreateReport({ user: user(req), body: await readJson(req) }, getDeps().reports)),
});

app.http("getReport", {
  methods: ["GET"],
  route: "reports/{id}",
  authLevel: "anonymous",
  handler: async (req) =>
    json(await handleGetReport({ user: user(req), reportId: req.params.id ?? "" }, getDeps().reports)),
});

app.http("createLinearIssue", {
  methods: ["POST"],
  route: "reports/{id}/linear",
  authLevel: "anonymous",
  handler: async (req) =>
    json(
      await handleCreateLinearIssue(
        { user: user(req), reportId: req.params.id ?? "", body: await readJson(req) },
        getDeps().linear,
      ),
    ),
});

app.http("analyze", {
  methods: ["POST"],
  route: "agent/analyze",
  authLevel: "anonymous",
  handler: async (req) => json(await handleAnalyze({ user: user(req), body: await readJson(req) }, getDeps().analyze)),
});

/** Deployment check: which backend each service uses. No data, no secrets. */
app.http("health", {
  methods: ["GET"],
  route: "health",
  authLevel: "anonymous",
  handler: async () => json({ status: 200, body: { ok: true, backends: getDeps().backends } }),
});
