import type {
  AccountBriefResponse,
  ChatResponse,
  ClaimCheckResponse,
  CreateLinearIssueResponse,
  ReportResponse,
  TicketDraft,
  TranscribeResponse,
} from '@deeproot/shared';
import { ACCOUNT_ID, answerDemoQuestion, checkDemoClaim, demoBriefResponse, DEMO_TRANSCRIPT, emailSources, makeDemoReport, meetingSource } from './demo';
import { ApiError, toBrief } from './model';
import type { Brief } from './model';

export const isLive = import.meta.env.VITE_API_MODE === 'live';
const pause = () => new Promise((resolve) => window.setTimeout(resolve, 520));

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Could not reach Deeproot. Please try again.', 503);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.error;
    const message = typeof detail?.message === 'string' ? detail.message :
      response.status === 401 ? 'Sign in to continue.' :
      response.status === 404 ? 'This account or report is not available to you.' :
      'This request could not be completed.';
    throw new ApiError(message, response.status, typeof detail?.fallbackUrl === 'string' ? detail.fallbackUrl : undefined);
  }
  return payload as T;
}

const jsonBody = (value: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

export const api = {
  async getBrief(accountId: string): Promise<Brief> {
    if (isLive) {
      const response = await jsonRequest<AccountBriefResponse>(`/api/accounts/${encodeURIComponent(accountId)}/brief`);
      return toBrief(response);
    }
    await pause();
    if (accountId !== ACCOUNT_ID) throw new ApiError('This account is not available to you.', 404);
    return toBrief(demoBriefResponse);
  },

  async transcribe(accountId: string, file: File): Promise<TranscribeResponse> {
    if (isLive) {
      const form = new FormData();
      form.append('accountId', accountId);
      form.append('audio', file);
      return jsonRequest<TranscribeResponse>('/api/meetings/transcribe', { method: 'POST', body: form });
    }
    await pause();
    return { transcript: DEMO_TRANSCRIPT, segments: [], origin: 'prepared-fallback' };
  },

  async createReport(accountId: string, transcript: string): Promise<ReportResponse> {
    if (isLive) return jsonRequest<ReportResponse>('/api/reports', jsonBody({ accountId, transcript }));
    await pause();
    return { report: makeDemoReport(transcript), sources: [...emailSources, meetingSource(transcript)] };
  },

  async getReport(reportId: string): Promise<ReportResponse> {
    if (isLive) return jsonRequest<ReportResponse>(`/api/reports/${encodeURIComponent(reportId)}`);
    await pause();
    if (reportId !== 'demo-acme-report') throw new ApiError('Report not found.', 404);
    return { report: makeDemoReport(DEMO_TRANSCRIPT), sources: [...emailSources, meetingSource(DEMO_TRANSCRIPT)] };
  },

  async createIssue(reportId: string, ticket: TicketDraft): Promise<CreateLinearIssueResponse> {
    if (isLive) {
      return jsonRequest<CreateLinearIssueResponse>(
        `/api/reports/${encodeURIComponent(reportId)}/linear`,
        jsonBody({ ticket }),
      );
    }
    await pause();
    return { issue: { identifier: 'DEMO-104', url: '' }, alreadyCreated: false };
  },

  async chat(accountId: string, question: string, reportId?: string): Promise<ChatResponse> {
    if (isLive) return jsonRequest<ChatResponse>('/api/chat', jsonBody({ accountId, question, reportId }));
    await pause();
    if (accountId !== ACCOUNT_ID) throw new ApiError('This account is not available to you.', 404);
    return answerDemoQuestion(question);
  },

  async checkClaim(accountId: string, statement: string): Promise<ClaimCheckResponse> {
    if (isLive) return jsonRequest<ClaimCheckResponse>('/api/claims/check', jsonBody({ accountId, statement }));
    await pause();
    if (accountId !== ACCOUNT_ID) throw new ApiError('This account is not available to you.', 404);
    return checkDemoClaim(statement);
  },
};
