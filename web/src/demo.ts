import { ACCOUNTS, NORTHSTAR_CUSTOMER_EMAIL, NORTHSTAR_INTERNAL_EMAIL, NORTHSTAR_KICKOFF, NORTHSTAR_MEETING_DATE, NORTHSTAR_MEETING_TRANSCRIPT, SAMPLE_NORTHSTAR_REPORT, SAMPLE_SOURCE_IDS } from '@deeproot/demo';
import type { AccountBriefResponse, ChatResponse, ClaimCheckResponse, MeetingReport, PublicSource } from '@deeproot/shared';
import { assistantBoundary, assistantRefusalMessage } from '@deeproot/shared';

export const ACCOUNT_ID = 'northstar';
export const DEMO_TRANSCRIPT = NORTHSTAR_MEETING_TRANSCRIPT;
const S = SAMPLE_SOURCE_IDS;

// Raw mail fixtures are adapted for mock display. Live sources always come from the API.
function mailSource(mail: typeof NORTHSTAR_CUSTOMER_EMAIL | typeof NORTHSTAR_INTERNAL_EMAIL, id: string): PublicSource {
  const body = 'text' in mail ? mail.text.replace(/\r\n/g, '\n').split('\n-- ')[0].trim() :
    mail.html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&#8217;/g, '’').replace(/&#39;/g, "'").trim();
  return { id, accountId: ACCOUNT_ID, kind: 'email', title: mail.subject, author: mail.from, occurredAt: new Date(mail.sentAt).toISOString(), body };
}

export const emailSources: PublicSource[] = [
  mailSource(NORTHSTAR_INTERNAL_EMAIL, S.internalEmail),
  mailSource(NORTHSTAR_CUSTOMER_EMAIL, S.customerEmail),
];

export const meetingSource = (transcript: string): PublicSource => ({
  id: S.meeting, accountId: ACCOUNT_ID, kind: 'meeting', title: 'Northstar Logistics meeting',
  author: 'Meeting transcript', occurredAt: NORTHSTAR_MEETING_DATE, body: transcript,
});

const otherSources: PublicSource[] = [
  { id: S.kickoff, accountId: ACCOUNT_ID, kind: 'meeting', title: NORTHSTAR_KICKOFF.title, author: 'Meeting transcript', occurredAt: NORTHSTAR_KICKOFF.occurredAt, body: NORTHSTAR_KICKOFF.transcript },
  { id: S.tracker, accountId: ACCOUNT_ID, kind: 'internal_app', app: { id: 'impl-tracker', name: 'Implementation Tracker' }, title: 'State tax setup: Ohio and Pennsylvania', author: 'Jordan Ellis', occurredAt: '2026-10-01T13:00:00Z', body: "Ticket: IT-5120\nStatus: Blocked\nAssignee: Unassigned\nDue: 2026-10-08\nGo-live: 2026-10-22\nNotes: State tax mapping incomplete. Waiting on client's Ohio withholding account number. PA local tax codes missing for 14 employees." },
  { id: S.ohioConfig, accountId: ACCOUNT_ID, kind: 'internal_app', app: { id: 'payroll-config', name: 'Payroll Configuration Dashboard' }, title: 'Ohio withholding (SIT)', author: 'Jordan Ellis', occurredAt: '2026-10-01T21:30:00Z', body: 'Area: State income tax\nSetting: Ohio withholding (SIT)\nStatus: INCOMPLETE\nMissing: Ohio withholding account number\nEmployees affected: 24' },
  { id: S.paConfig, accountId: ACCOUNT_ID, kind: 'internal_app', app: { id: 'payroll-config', name: 'Payroll Configuration Dashboard' }, title: 'Pennsylvania local earned income tax', author: 'Jordan Ellis', occurredAt: '2026-10-01T21:35:00Z', body: 'Area: Local tax\nSetting: Pennsylvania local earned income tax\nStatus: INCOMPLETE\nMissing: PSD codes, work location municipality\nEmployees affected: 14' },
];

export const demoBriefResponse: AccountBriefResponse = {
  account: { id: ACCOUNT_ID, name: ACCOUNTS.find((account) => account.id === ACCOUNT_ID)!.name },
  emails: emailSources,
  brief: {
    summary: 'Northstar’s October 15 first payroll is at risk: state tax setup is incomplete for 38 employees in Ohio and Pennsylvania. The Ohio withholding account number is needed by October 8, and no delivery owner has been named.',
    items: [
      { text: '38 employees still need state tax setup.', type: 'blocker', severity: 'high', citations: [{ sourceId: S.customerEmail, quote: "38 employees in Ohio and Pennsylvania still don't have state tax setup in the new system." }] },
      { text: 'The October 15 payroll launch is at risk if the Ohio account number does not arrive by October 8.', type: 'risk', severity: 'high', citations: [{ sourceId: S.internalEmail, quote: "If the Ohio account number doesn't arrive by October 8, the October 15 payroll launch is at risk." }] },
    ],
    openQuestions: ['Who owns the Ohio and Pennsylvania state tax setup?', 'When will Northstar send the Ohio withholding account number?', 'Where do the 14 Pennsylvania employees work?'],
  },
};

export function makeDemoReport(transcript: string): MeetingReport {
  return { ...structuredClone(SAMPLE_NORTHSTAR_REPORT), transcript };
}

export function reportSources(transcript: string): PublicSource[] {
  return [...emailSources, ...otherSources, meetingSource(transcript)];
}

export function answerDemoQuestion(question: string): ChatResponse {
  const boundary = assistantBoundary(question);
  if (boundary) return { answer: assistantRefusalMessage(boundary), responseType: boundary, citations: [], sources: [], grounded: false };
  if (/betaco|beta co|other client|restricted/i.test(question)) {
    return { answer: 'I cannot answer that from this account workspace.', citations: [], sources: [], grounded: false };
  }
  if (/who|owner/i.test(question)) {
    return { answer: 'No owner was named in the meeting. The tracker ticket is unassigned.', citations: [{ sourceId: S.meeting, quote: 'Let me confirm with the team and get back to you.' }, { sourceId: S.tracker, quote: 'Assignee: Unassigned' }], sources: [meetingSource(DEMO_TRANSCRIPT), otherSources[1]], grounded: true };
  }
  return { answer: 'State tax setup remains incomplete for 38 employees in Ohio and Pennsylvania. The Ohio withholding account number is needed by October 8 to protect the October 15 payroll launch.', citations: [{ sourceId: S.customerEmail, quote: "38 employees in Ohio and Pennsylvania still don't have state tax setup in the new system." }, { sourceId: S.internalEmail, quote: "If the Ohio account number doesn't arrive by October 8, the October 15 payroll launch is at risk." }], sources: emailSources, grounded: true };
}

export function checkDemoClaim(statement: string): ClaimCheckResponse {
  const boundary = assistantBoundary(statement);
  if (boundary) return { verdict: 'uncertain', explanation: assistantRefusalMessage(boundary), refusalReason: boundary, citations: [], sources: [], suggestedRewrite: '' };
  if (/complete|ready|on track|no risk|will launch/i.test(statement)) {
    return { verdict: 'contradicted', explanation: 'State tax setup remains incomplete, and the internal email says the October 15 launch is at risk.', citations: [{ sourceId: S.internalEmail, quote: "If the Ohio account number doesn't arrive by October 8, the October 15 payroll launch is at risk." }], sources: [emailSources[0]], suggestedRewrite: 'State tax setup remains incomplete. We are waiting on the Ohio withholding account number and will confirm the October 15 payroll timing.' };
  }
  if (/38 employees|ohio and pennsylvania/i.test(statement)) {
    return { verdict: 'supported', explanation: 'Maya’s email confirms the affected employees and states.', citations: [{ sourceId: S.customerEmail, quote: "38 employees in Ohio and Pennsylvania still don't have state tax setup in the new system." }], sources: [emailSources[1]], suggestedRewrite: statement.trim() };
  }
  return { verdict: 'uncertain', explanation: 'The available Northstar sources do not establish this statement clearly.', citations: [], sources: [], suggestedRewrite: '' };
}
