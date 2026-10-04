import type {
  AccountBriefResponse,
  PublicSource, DemoAppRecord, IntegrationsResponse, IntegrationStatus,
  ChatMessage,
  ChatResponse,
  ClaimCheckResponse,
  CreateLinearIssueResponse,
  ReportResponse,
  TicketDraft,
  TranscribeResponse,
} from '@deeproot/shared';
import { SAMPLE_REPORT_ID } from '@deeproot/demo';
import { ACCOUNT_ID, answerDemoQuestion, checkDemoClaim, demoBriefResponse, DEMO_TRANSCRIPT, makeDemoReport, reportSources } from './demo';
import { ApiError, toBrief } from './model';
import type { Brief } from './model';
import { combineTranscriptions, prepareMeetingAudio } from './meetingAudio';

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
    const message = response.status === 404 ? 'Not found' : typeof detail?.message === 'string' ? detail.message :
      response.status === 401 ? 'Sign in to continue.' :
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
  async getSource(accountId: string, sourceId: string, version?: string, reportId?: string): Promise<PublicSource> {
    const query = new URLSearchParams(); if (version) query.set('version', version); if (reportId) query.set('reportId', reportId);
    if (!isLive) { const source = reportSources(DEMO_TRANSCRIPT).find(s => s.id === sourceId); if (!source) throw new ApiError('Source unavailable', 404); return source; }
    return (await jsonRequest<{ source: PublicSource }>(`/api/accounts/${encodeURIComponent(accountId)}/sources/${encodeURIComponent(sourceId)}?${query}`)).source;
  },
  async getIntegrations(accountId: string): Promise<IntegrationsResponse> {
    if (!isLive) return { integrations: [], demoAppsEnabled: false };
    return jsonRequest(`/api/accounts/${encodeURIComponent(accountId)}/integrations`);
  },
  async getDemoRecords(accountId: string, appId: string): Promise<DemoAppRecord[]> {
    return (await jsonRequest<{ records: DemoAppRecord[] }>(`/api/demo-apps/${encodeURIComponent(appId)}/accounts/${encodeURIComponent(accountId)}/records`)).records;
  },
  async editDemoRecord(accountId: string, appId: string, record: DemoAppRecord, changes: Record<string, unknown>): Promise<void> {
    await jsonRequest(`/api/demo-apps/${encodeURIComponent(appId)}/accounts/${encodeURIComponent(accountId)}/records/${encodeURIComponent(record.id)}`, { ...jsonBody({ revision: record.revision, changes }), method: 'PATCH' });
  },
  async createDemoRecord(accountId: string, appId: string, title: string): Promise<void> { await jsonRequest(`/api/demo-apps/${encodeURIComponent(appId)}/accounts/${encodeURIComponent(accountId)}/records`, jsonBody({ title })); },
  async deleteDemoRecord(accountId: string, appId: string, record: DemoAppRecord): Promise<void> { await jsonRequest(`/api/demo-apps/${encodeURIComponent(appId)}/accounts/${encodeURIComponent(accountId)}/records/${encodeURIComponent(record.id)}`, { ...jsonBody({ revision: record.revision }), method: 'DELETE' }); },
  async resetDemoRecords(accountId: string, appId: string): Promise<void> { await jsonRequest(`/api/demo-apps/${encodeURIComponent(appId)}/accounts/${encodeURIComponent(accountId)}/reset`, jsonBody({})); },
  async syncIntegration(accountId: string, appId: string): Promise<IntegrationStatus> { return jsonRequest(`/api/accounts/${encodeURIComponent(accountId)}/integrations/${encodeURIComponent(appId)}/sync`, jsonBody({})); },
  async refreshBrief(accountId: string): Promise<Brief> {
    if (isLive) await jsonRequest('/api/agent/analyze', jsonBody({ accountId }));
    return api.getBrief(accountId);
  },
  async getBrief(accountId: string): Promise<Brief> {
    if (isLive) {
      const response = await jsonRequest<AccountBriefResponse>(`/api/accounts/${encodeURIComponent(accountId)}/brief`);
      return toBrief(response);
    }
    await pause();
    if (accountId !== ACCOUNT_ID) throw new ApiError('Not found', 404);
    return toBrief(demoBriefResponse);
  },

  async transcribe(accountId: string, file: File): Promise<TranscribeResponse> {
    if (isLive) {
      // Long recordings arrive as several parts; each is its own small request, sent in order.
      const results: TranscribeResponse[] = [];
      for (const part of await prepareMeetingAudio(file)) {
        const form = new FormData();
        form.append('accountId', accountId);
        form.append('audio', part);
        results.push(await jsonRequest<TranscribeResponse>('/api/meetings/transcribe', { method: 'POST', body: form }));
      }
      return combineTranscriptions(results);
    }
    await pause();
    return { transcript: DEMO_TRANSCRIPT, segments: [], origin: 'prepared-fallback' };
  },

  async createReport(accountId: string, transcript: string, previousReportId?: string): Promise<ReportResponse> {
    if (isLive) return jsonRequest<ReportResponse>('/api/reports', jsonBody({ accountId, transcript, previousReportId }));
    await pause();
    if (transcript.trim() !== DEMO_TRANSCRIPT.trim()) throw new ApiError("Mock mode previews the prepared meeting only. Use the local live API to analyze a changed transcript.", 400);
    return { report: makeDemoReport(transcript), sources: reportSources(transcript) };
  },

  async getReport(reportId: string): Promise<ReportResponse> {
    if (isLive) return jsonRequest<ReportResponse>(`/api/reports/${encodeURIComponent(reportId)}`);
    await pause();
    if (reportId !== SAMPLE_REPORT_ID) throw new ApiError('Not found', 404);
    return { report: makeDemoReport(DEMO_TRANSCRIPT), sources: reportSources(DEMO_TRANSCRIPT) };
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

  async chat(accountId: string, question: string, reportId?: string, history?: ChatMessage[]): Promise<ChatResponse> {
    if (isLive) return jsonRequest<ChatResponse>('/api/chat', jsonBody({ accountId, question, reportId, history }));
    await pause();
    if (accountId !== ACCOUNT_ID) throw new ApiError('Not found', 404);
    return answerDemoQuestion(question);
  },

  async checkClaim(accountId: string, statement: string, reportId?: string): Promise<ClaimCheckResponse> {
    if (isLive) return jsonRequest<ClaimCheckResponse>('/api/claims/check', jsonBody({ accountId, statement, reportId }));
    await pause();
    if (accountId !== ACCOUNT_ID) throw new ApiError('Not found', 404);
    return checkDemoClaim(statement);
  },
};
