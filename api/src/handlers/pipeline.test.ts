// The whole backend pipeline through its handlers, with every Azure adapter replaced by a fake:
//   emails + Zoom audio + internal app exports -> ingestion -> Cosmos (sources)
//   -> Gemini analysis -> Cosmos (analyses) -> read back for UI, morning brief, action items, Linear
import {
  ACCOUNTS,
  BETACO_CANARY,
  DEMO_RAW_EMAILS,
  DEMO_SPEAKER_NAMES,
  DEMO_USERS,
  IMPLEMENTATION_TRACKER_EXPORT,
  NORTHSTAR_MEETING_DATE,
  NORTHSTAR_MEETING_TRANSCRIPT,
  PAYROLL_CONFIG_EXPORT,
} from "@deeproot/demo";
import type { AgentAnalysis, TranscribeResponse } from "@deeproot/shared";
import { describe, expect, it } from "vitest";
import { DEMO_EMAIL_ROUTING } from "../ingest/connectors/index.js";
import { InMemoryAnalysisStore } from "../store/analyses.js";
import { InMemoryAccountDirectory } from "../store/reports.js";
import { InMemorySourceSearch } from "../store/sources.js";
import { IDS, QUOTES, reply, scriptedModel } from "../testing/agent.js";
import { wav } from "../testing/audio.js";
import { handleAnalyze, handleGetLatestAnalysis } from "./analyze.js";
import { handleIngestAppRecords, handleIngestEmails, handleSaveMeeting } from "./ingest.js";
import { handleTranscribe } from "./transcribe.js";

describe("backend pipeline", () => {
  it("takes Northstar from raw inputs to a stored, grounded cross-source analysis", async () => {
    const user = { userId: DEMO_USERS.presenter };
    const accounts = new InMemoryAccountDirectory(ACCOUNTS);
    const sources = new InMemorySourceSearch(); // stands in for Cosmos `sources`
    const analyses = new InMemoryAnalysisStore(); // stands in for Cosmos `analyses`

    // 1. Emails and internal app exports in. BetaCo rows are rejected for the presenter.
    await handleIngestEmails({ user, body: { emails: DEMO_RAW_EMAILS } }, { accounts, sources, emailRouting: DEMO_EMAIL_ROUTING });
    for (const [appId, records] of [["impl-tracker", IMPLEMENTATION_TRACKER_EXPORT], ["payroll-config", PAYROLL_CONFIG_EXPORT]] as const) {
      await handleIngestAppRecords({ user, appId, body: { records } }, { accounts, sources, emailRouting: DEMO_EMAIL_ROUTING });
    }

    // 2. Meeting audio in, transcribed (fake Speech, diarized), reviewed, and saved.
    const transcribeResult = await handleTranscribe(
      { user, accountId: "northstar", audio: wav(), fileName: "meeting.wav" },
      {
        accounts,
        transcribeAudio: async () =>
          NORTHSTAR_MEETING_TRANSCRIPT.split("\n").map((line, i) => ({
            startMs: i * 4000,
            endMs: (i + 1) * 4000,
            speaker: line.startsWith("Maya:") ? "1" : "2",
            text: line.replace(/^\w+: /, ""),
          })),
        speakerNames: DEMO_SPEAKER_NAMES,
      },
    );
    const transcribed = transcribeResult.body as TranscribeResponse;
    expect(transcribed.transcript).toBe(NORTHSTAR_MEETING_TRANSCRIPT);
    const saved = await handleSaveMeeting(
      { user, body: { accountId: "northstar", meetingId: "live-demo", transcript: transcribed.transcript, occurredAt: NORTHSTAR_MEETING_DATE } },
      { accounts, sources },
    );
    expect(saved.status).toBe(201);

    // 3. Analysis over what's stored. The fake model answers like a good model would.
    const model = scriptedModel(reply([
      {
        type: "risk",
        title: "October 15 payroll at risk: state tax setup incomplete",
        description: "Four systems describe the same unfinished Ohio and Pennsylvania tax setup.",
        basis: "inferred",
        severity: "high",
        citations: [
          { sourceId: IDS.customerEmail, quote: QUOTES.customer38 },
          { sourceId: IDS.meeting, quote: QUOTES.meetingSlip },
          { sourceId: IDS.tracker, quote: QUOTES.trackerBlocked },
          { sourceId: IDS.ohioConfig, quote: QUOTES.ohioMissing },
        ],
      },
    ]));

    const analyzed = await handleAnalyze({ user, body: { accountId: "northstar" } }, { accounts, search: sources, model, analyses });
    expect(analyzed.status).toBe(200);

    expect(model.calls[0]!.user).toContain(IDS.meeting); // the reviewed meeting reached the model via storage
    expect(JSON.stringify(model.calls)).not.toContain(BETACO_CANARY);

    // 4. Downstream features read the stored analysis without calling the model again.
    const latest = await handleGetLatestAnalysis({ user, accountId: "northstar" }, { accounts, analyses });
    const [risk] = (latest.body as AgentAnalysis).findings;
    expect(risk).toMatchObject({ type: "risk", severity: "high", relatedSourceIds: [IDS.customerEmail, IDS.meeting, IDS.tracker, IDS.ohioConfig] });
    expect(model.calls).toHaveLength(1);
  });
});
