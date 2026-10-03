import { ACME_CUSTOMER_EMAIL, ACME_INTERNAL_EMAIL, ACME_MEETING_DATE, ACME_MEETING_TRANSCRIPT } from '@deeproot/demo';
import type { AccountBriefResponse, ChatResponse, ClaimCheckResponse, MeetingReport, PublicSource } from '@deeproot/shared';

export const ACCOUNT_ID = 'acme';
export const DEMO_TRANSCRIPT = ACME_MEETING_TRANSCRIPT;

function publicSource(record: typeof ACME_CUSTOMER_EMAIL): PublicSource {
  return {
    id: record.id,
    accountId: record.accountId,
    kind: record.kind,
    title: record.title,
    author: record.author,
    occurredAt: record.occurredAt,
    body: record.body,
  };
}

export const emailSources: PublicSource[] = [publicSource(ACME_INTERNAL_EMAIL), publicSource(ACME_CUSTOMER_EMAIL)];

export const meetingSource = (transcript: string): PublicSource => ({
  id: 'acme-meeting',
  accountId: ACCOUNT_ID,
  kind: 'meeting',
  title: 'Acme account meeting',
  author: 'Meeting transcript',
  occurredAt: ACME_MEETING_DATE,
  body: transcript,
});

export const demoBriefResponse: AccountBriefResponse = {
  account: { id: ACCOUNT_ID, name: 'Acme Corporation' },
  emails: emailSources,
  brief: {
    summary: 'Acme needs a payroll export for both its US and Canada subsidiaries. The current export supports US only. Confirm the Canada scope and CAD currency before committing to delivery.',
    items: [
      { text: 'Acme requested both US and Canada subsidiaries.', citations: [{ sourceId: ACME_CUSTOMER_EMAIL.id, quote: 'both our US and Canada subsidiaries' }] },
      { text: 'The existing export covers only US.', citations: [{ sourceId: ACME_INTERNAL_EMAIL.id, quote: 'the current payroll export only supports the US subsidiary' }] },
    ],
    openQuestions: ['What work is required for Canada provincial tax fields and CAD?', 'Who will own the export and client update?'],
  },
};

export function makeDemoReport(transcript: string): MeetingReport {
  const statedPromise = 'We can have the payroll export ready for you by Friday.';
  const meetingQuote = transcript.includes(statedPromise)
    ? statedPromise
    : transcript.split('\n').find((line) => line.toLowerCase().includes('payroll export'))?.trim() || transcript.trim().split('\n')[0] || '';
  const meetingCitation = { sourceId: 'acme-meeting', quote: meetingQuote };
  const customerCitation = { sourceId: ACME_CUSTOMER_EMAIL.id, quote: 'both our US and Canada subsidiaries' };
  const gapCitation = { sourceId: ACME_INTERNAL_EMAIL.id, quote: 'the current payroll export only supports the US subsidiary' };

  return {
    id: 'demo-acme-report',
    accountId: ACCOUNT_ID,
    transcript,
    summary: 'The team promised an Acme payroll export by Friday. Earlier email requires both US and Canada subsidiaries, while the current export supports US only. Canada scope and currency need confirmation before delivery.',
    decisions: [{ text: 'Target delivery of the payroll export for Friday.', citations: [meetingCitation] }],
    commitments: [{
      text: 'Deliver an Acme payroll export covering both US and Canada subsidiaries.',
      owner: null,
      dueDate: '2026-10-02',
      citations: [meetingCitation, customerCitation],
    }],
    risks: [{ text: 'The current export covers only US; Canada needs provincial tax fields and CAD currency mapping.', citations: [gapCitation] }],
    openQuestions: ['Who owns the export and client update?', 'How will Canada provincial tax fields and CAD be validated?'],
    suggestedFollowUp: 'Confirm Canada scope and currency with delivery, assign an owner, and update Acme on the Friday commitment.',
    ticketDraft: {
      title: 'Deliver Acme payroll export for US and Canada',
      description: 'Acme requested one payroll export covering both subsidiaries. The meeting set a Friday delivery target, but the current export supports US only. Canada mapping and validation are required.',
      acceptanceCriteria: [
        'Export includes payroll data for both US and Canada subsidiaries.',
        'Canada provincial tax fields and CAD currency handling are confirmed and validated.',
        'An owner and delivery status are communicated to Acme.',
      ],
      priority: 'high',
    },
    createdAt: ACME_MEETING_DATE,
    createdBy: 'presenter',
  };
}

export function answerDemoQuestion(question: string): ChatResponse {
  if (/betaco|beta co|other client|restricted/i.test(question)) {
    return { answer: 'I cannot answer that from this account workspace.', citations: [], sources: [], grounded: false };
  }
  if (/who|owner/i.test(question)) {
    return {
      answer: 'No delivery owner was named in the meeting. The representative said they would check with the team and get back to Acme.',
      citations: [{ sourceId: 'acme-meeting', quote: 'Let me check with the team and get back to you on that.' }],
      sources: [meetingSource(DEMO_TRANSCRIPT)], grounded: true,
    };
  }
  return {
    answer: 'Acme asked for both US and Canada subsidiaries. The internal note says the current export supports only US, so Canada remains a delivery gap.',
    citations: [
      { sourceId: ACME_CUSTOMER_EMAIL.id, quote: 'both our US and Canada subsidiaries' },
      { sourceId: ACME_INTERNAL_EMAIL.id, quote: 'the current payroll export only supports the US subsidiary' },
    ],
    sources: emailSources, grounded: true,
  };
}

export function checkDemoClaim(statement: string): ClaimCheckResponse {
  if (/canada|both/i.test(statement) && /already|currently|supports|ready|complete|done/i.test(statement)) {
    return {
      verdict: 'contradicted',
      explanation: 'The internal delivery email says the current export supports only the US subsidiary.',
      citations: [{ sourceId: ACME_INTERNAL_EMAIL.id, quote: 'the current payroll export only supports the US subsidiary' }],
      sources: [publicSource(ACME_INTERNAL_EMAIL)],
      suggestedRewrite: 'The current export supports US payroll. We are confirming the work needed to include Canada before delivery.',
    };
  }
  if (/us and canada|both.*subsidiar/i.test(statement) && /requested|asked|need/i.test(statement)) {
    return {
      verdict: 'supported', explanation: 'Acme explicitly requested both subsidiaries in its email.',
      citations: [{ sourceId: ACME_CUSTOMER_EMAIL.id, quote: 'both our US and Canada subsidiaries' }],
      sources: [publicSource(ACME_CUSTOMER_EMAIL)], suggestedRewrite: statement.trim(),
    };
  }
  return {
    verdict: 'uncertain', explanation: 'The available Acme sources do not establish this statement clearly.',
    citations: [], sources: [], suggestedRewrite: 'We will confirm this detail with the delivery team and follow up with Acme.',
  };
}
