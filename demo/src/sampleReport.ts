// Hand-written example of a good report for the Northstar meeting.
// Used by backend tests and as a mock response for the frontend; Teammate 3's real output should look like this.
// Every quote must appear verbatim in the ingested source (checked in api/src/handlers/sampleReport.test.ts).
import type { MeetingReport } from "@deeproot/shared";
import { DEMO_USERS, NORTHSTAR_MEETING_TRANSCRIPT } from "./fixtures.js";

export const SAMPLE_REPORT_ID = "report-northstar-sample";

/** Source IDs as produced by api/src/ingest (buildSeedSources and meetingToSource). */
export const SAMPLE_SOURCE_IDS = {
  customerEmail: "northstar-email-can7x2lq-mail-northstar-example",
  internalEmail: "northstar-email-20260930194500-jellis-meridianpay-example",
  kickoff: "northstar-meeting-kickoff-2026-09-24",
  tracker: "northstar-impl-tracker-it-5120",
  ohioConfig: "northstar-payroll-config-88213",
  paConfig: "northstar-payroll-config-88214",
  /** The uploaded meeting, ingested with meetingId = report ID. */
  meeting: `northstar-meeting-${SAMPLE_REPORT_ID}`,
} as const;

const S = SAMPLE_SOURCE_IDS;

export const SAMPLE_NORTHSTAR_REPORT: MeetingReport = {
  id: SAMPLE_REPORT_ID,
  accountId: "northstar",
  transcript: NORTHSTAR_MEETING_TRANSCRIPT,
  summary:
    "Maya asked about the October 15 payroll launch. Sam said state tax setup for Ohio and Pennsylvania is the open item and the launch may slip, but did not name an owner. Other sources show 38 employees affected, a blocked tracker ticket due October 8, and a missing Ohio withholding account number.",
  decisions: [],
  commitments: [
    {
      text: "Confirm who on our team owns the Ohio and Pennsylvania state tax setup and report back to Maya.",
      owner: null,
      dueDate: null,
      citations: [
        { sourceId: S.meeting, quote: "Let me confirm with the team and get back to you." },
        { sourceId: S.customerEmail, quote: "Can you confirm who on your team is handling the state tax mapping?" },
      ],
      risk: "Nobody is assigned: the tracker ticket is Unassigned and no owner was named in the meeting.",
    },
  ],
  risks: [
    {
      text: "The October 15 payroll may slip for 38 employees in Ohio and Pennsylvania.",
      citations: [
        { sourceId: S.meeting, quote: "Then the October 15 payroll may slip for those employees." },
        {
          sourceId: S.customerEmail,
          quote: "38 employees in Ohio and Pennsylvania still don't have state tax setup in the new system.",
        },
      ],
    },
    {
      text: "The Ohio withholding account number must arrive by October 8, or the launch is at risk.",
      citations: [
        {
          sourceId: S.internalEmail,
          quote: "If the Ohio account number doesn't arrive by October 8, the October 15 payroll launch is at risk.",
        },
        { sourceId: S.tracker, quote: "Status: Blocked" },
        { sourceId: S.ohioConfig, quote: "Missing: Ohio withholding account number" },
      ],
    },
    {
      text: "14 Pennsylvania employees are missing local tax (PSD) codes, which were flagged at kickoff.",
      citations: [
        { sourceId: S.paConfig, quote: "Missing: PSD codes, work location municipality" },
        { sourceId: S.kickoff, quote: "Ohio and Pennsylvania have local taxes too, so please make sure those are covered." },
      ],
    },
  ],
  openQuestions: [
    "Who owns the Ohio and Pennsylvania state tax setup?",
    "When will Northstar send the Ohio withholding account number?",
    "Where do the 14 Pennsylvania employees work, so PSD codes can be assigned?",
  ],
  suggestedFollowUp:
    "Assign an owner for IT-5120 today, then ask Maya for the Ohio withholding account number before October 8 and the work locations for the 14 Pennsylvania employees.",
  ticketDraft: {
    title: "Northstar: finish Ohio and Pennsylvania state tax setup before October 15 payroll",
    description:
      "Northstar's first payroll on the new platform runs October 15. State tax setup is incomplete for 38 employees in Ohio and Pennsylvania. Ohio withholding is waiting on the client's account number (needed by October 8), and 14 Pennsylvania employees are missing local tax (PSD) codes. Tracker ticket IT-5120 is blocked and unassigned.",
    acceptanceCriteria: [
      "Ohio withholding (SIT) is configured with Northstar's Ohio withholding account number for all 24 Ohio employees",
      "Pennsylvania local earned income tax has PSD codes and work location municipality for all 14 employees",
      "Ohio account number is received from Northstar by October 8, or Maya is told the launch is at risk",
      "An owner is assigned and IT-5120 is updated",
    ],
    priority: "high",
  },
  createdAt: "2026-10-02T15:10:00Z",
  createdBy: DEMO_USERS.presenter,
};
