// Hand-written example of a good report for the Acme meeting.
// Used by backend tests and as a mock response for the frontend; Teammate 3's real output should look like this.
import type { MeetingReport } from "@deeproot/shared";
import { ACME_MEETING_TRANSCRIPT, DEMO_USERS } from "./fixtures.js";

export const SAMPLE_ACME_REPORT: MeetingReport = {
  id: "report-acme-sample",
  accountId: "acme",
  transcript: ACME_MEETING_TRANSCRIPT,
  summary:
    "Acme asked when the payroll export will be ready. Marcus promised it by Friday but did not name an owner. Acme's earlier email requires both US and Canada subsidiaries, and the internal team says only the US export exists today.",
  decisions: [
    {
      text: "The payroll export is the main deliverable for Acme.",
      citations: [
        {
          sourceId: "acme-meeting-transcript",
          quote: "Our main ask is still the payroll export.",
        },
      ],
    },
  ],
  commitments: [
    {
      text: "Deliver the payroll export to Acme.",
      owner: null,
      dueDate: "2026-10-02",
      citations: [
        {
          sourceId: "acme-meeting-transcript",
          quote: "We can have the payroll export ready for you by Friday.",
        },
        {
          sourceId: "acme-email-customer",
          quote: "The payroll export needs to cover both our US and Canada subsidiaries, Acme Corp US and Acme Canada Ltd.",
        },
      ],
      risk: "Canada is required but not yet supported, so a Friday date for both subsidiaries is at risk.",
    },
  ],
  risks: [
    {
      text: "The current export supports only the US subsidiary; Canada needs provincial tax fields and CAD mapping.",
      citations: [
        {
          sourceId: "acme-email-internal",
          quote: "the current payroll export only supports the US subsidiary.",
        },
        {
          sourceId: "acme-email-internal",
          quote: "please do not promise a Canada date until we talk.",
        },
      ],
    },
  ],
  openQuestions: [
    "Who on our team owns delivering the export?",
    "Will Canada amounts be in CAD?",
    "Can Canada ship by Friday, or does Acme accept the US first?",
  ],
  suggestedFollowUp:
    "Confirm an owner internally, scope the Canada work with Priya, then reply to Dana with an accurate date for each subsidiary.",
  ticketDraft: {
    title: "Acme payroll export for US and Canada subsidiaries",
    description:
      "Acme needs one payroll export covering Acme Corp US and Acme Canada Ltd., which their finance team reconciles together at month end. The account team promised delivery by Friday 2026-10-02. The current export supports only the US subsidiary.",
    acceptanceCriteria: [
      "Export includes payroll for both US and Canada subsidiaries (Acme Corp US and Acme Canada Ltd.)",
      "Canada provincial tax fields are mapped",
      "Currency for Canada amounts is confirmed with Acme (CAD expected)",
      "Delivery date for each subsidiary is confirmed with Acme",
    ],
    priority: "high",
  },
  createdAt: "2026-10-01T15:10:00Z",
  createdBy: DEMO_USERS.presenter,
};
