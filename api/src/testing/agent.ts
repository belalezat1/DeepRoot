// Test helpers for the agent: a scripted stand-in for the Azure model, and the Northstar corpus.
import { ACCOUNTS, NORTHSTAR_MEETING_DATE, NORTHSTAR_MEETING_TRANSCRIPT, SAMPLE_SOURCE_IDS } from "@deeproot/demo";
import type { SourceRecord } from "@deeproot/shared";
import type { ChatModel, ChatModelRequest } from "../agent/model.js";
import { meetingToSource } from "../ingest/meeting.js";
import { buildSeedSources } from "../ingest/seed.js";

export type ScriptedModel = ChatModel & { calls: ChatModelRequest[] };

/** Replies in order: a string is returned, an Error is thrown. Records every request. */
export function scriptedModel(...replies: Array<string | Error>): ScriptedModel {
  const calls: ChatModelRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const reply = replies[calls.length - 1];
      if (reply === undefined) throw new Error("scriptedModel: no reply left");
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

export const reply = (findings: unknown[], summary = "Summary.") => JSON.stringify({ summary, findings });

/** The live meeting after review, as the downstream report flow would pass it in. */
export const LIVE_MEETING: SourceRecord = meetingToSource({
  account: ACCOUNTS.find((a) => a.id === "northstar")!,
  meetingId: "live-demo",
  transcript: NORTHSTAR_MEETING_TRANSCRIPT,
  occurredAt: NORTHSTAR_MEETING_DATE,
});

/** Every source in the demo, both accounts: seed plus the live meeting. */
export const ALL_SOURCES: SourceRecord[] = [...buildSeedSources(), LIVE_MEETING];

export const IDS = { ...SAMPLE_SOURCE_IDS, meeting: LIVE_MEETING.id };

/** Verbatim lines from the Northstar fixtures, for building model replies. */
export const QUOTES = {
  customer38: "38 employees in Ohio and Pennsylvania still don't have state tax setup in the new system.",
  customerOct15: "Our first payroll on the new platform runs October 15",
  internalRisk: "If the Ohio account number doesn't arrive by October 8, the October 15 payroll launch is at risk.",
  meetingSlip: "Then the October 15 payroll may slip for those employees.",
  meetingNoOwner: "Let me confirm with the team and get back to you.",
  trackerBlocked: "Status: Blocked",
  trackerUnassigned: "Assignee: Unassigned",
  trackerDue: "Due: 2026-10-08",
  trackerGoLive: "Go-live: 2026-10-22",
  ohioMissing: "Missing: Ohio withholding account number",
  ohio24: "Employees affected: 24",
  pa14: "Employees affected: 14",
} as const;
