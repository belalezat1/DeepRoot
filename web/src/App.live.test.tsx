// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_NORTHSTAR_REPORT, SAMPLE_REPORT_ID } from '@deeproot/demo';
import type { PublicSource } from '@deeproot/shared';
import { api } from './api';
import { demoBriefResponse, reportSources, DEMO_TRANSCRIPT } from './demo';
import { ApiError, toBrief } from './model';
import App from './App';

vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), isLive: true }));
const report = () => structuredClone(SAMPLE_NORTHSTAR_REPORT);

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  window.scrollTo = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  sessionStorage.setItem('deeproot-opening-seen', 'yes');
  localStorage.setItem('deeproot-effects', 'off');
  vi.spyOn(api, "getSource").mockImplementation(async (_account, id) => { const source = reportSources(DEMO_TRANSCRIPT).find(s => s.id === id); if (!source) throw new ApiError("Not found", 404); return source; });
  vi.spyOn(api, 'getBrief').mockResolvedValue(toBrief(demoBriefResponse));
  vi.spyOn(api, 'getReport').mockResolvedValue({ report: report(), sources: reportSources(DEMO_TRANSCRIPT) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem('deeproot-effects'); });

describe('live workspace regressions', () => {
  it('recovers missing brief evidence with an authorized read and offers retry after failure', async () => {
    const source: PublicSource = { id: 'missing-tracker', version: 'v1', accountId: 'northstar', kind: 'internal_app', title: 'Recovered tracker', author: 'Jordan', occurredAt: '2026-10-03', body: 'Owner: Sam' };
    vi.mocked(api.getBrief).mockResolvedValue(toBrief({ ...demoBriefResponse, sources: [], brief: { summary: 'A dependency needs attention.', items: [{ text: 'Check ownership', citations: [{ sourceId: source.id, sourceVersion: source.version, quote: source.body }] }], openQuestions: [] } }));
    vi.mocked(api.getSource).mockRejectedValueOnce(new ApiError('Unavailable', 503)).mockResolvedValueOnce(source);
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole('heading', { name: 'Northstar Logistics' });
    await user.click(screen.getByRole('button', { name: /View: Source/ }));
    await user.click(await screen.findByRole('button', { name: /Retry/ }));
    await screen.findByRole('heading', { name: source.title });
    expect(api.getSource).toHaveBeenLastCalledWith('northstar', source.id, 'v1', undefined);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a clear no-action report and disables Linear creation', async () => {
    window.history.replaceState({}, '', `/?report=${SAMPLE_REPORT_ID}`);
    vi.mocked(api.getReport).mockResolvedValue({ report: { ...report(), ticketStatus: 'none', ticketDraft: { title: '', description: '', acceptanceCriteria: [], priority: 'medium' } }, sources: reportSources(DEMO_TRANSCRIPT) });
    render(<App />); await screen.findByRole('heading', { name: 'Meeting report' });
    expect(screen.getByText('No actionable task was established by the reviewed evidence.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Issue title' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Create Linear issue' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps a bounded conversation and sends follow-up history', async () => {
    const answer = { answer: 'The Ohio account number is missing.', citations: [], sources: [], grounded: true };
    vi.spyOn(api, 'chat').mockResolvedValueOnce(answer).mockResolvedValueOnce({ ...answer, answer: 'It is needed by October 8.' });
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole('heading', { name: 'Northstar Logistics' });
    await user.click(screen.getByRole('button', { name: 'Ask & verify' }));
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'What is missing?');
    await user.click(screen.getByRole('button', { name: /Ask question/ }));
    await screen.findByText(answer.answer);
    await user.type(screen.getByRole('textbox', { name: 'Follow-up question' }), 'By when?');
    await user.click(screen.getByRole('button', { name: /Ask question/ }));
    await screen.findByText('It is needed by October 8.');
    expect(api.chat).toHaveBeenLastCalledWith('northstar', 'By when?', undefined, [{ role: 'user', content: 'What is missing?' }, { role: 'assistant', content: answer.answer }]);
    expect(within(screen.getByRole('log', { name: 'Account conversation' })).getByText(answer.answer)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText(answer.answer)).toBeNull();
  });

  it('displays a restricted response and hides unsupported rewrites', async () => {
    vi.spyOn(api, 'chat').mockResolvedValue({ answer: 'This role cannot disclose individual pay.', responseType: 'restricted', grounded: false, citations: [], sources: [] });
    vi.spyOn(api, 'checkClaim').mockResolvedValue({ verdict: 'uncertain', explanation: 'Outside this role.', refusalReason: 'restricted', citations: [], sources: [], suggestedRewrite: '' });
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole('heading', { name: 'Northstar Logistics' });
    await user.click(screen.getByRole('button', { name: 'Ask & verify' }));
    await user.click(screen.getByRole('button', { name: 'Show individual payroll details' }));
    await screen.findByText('◇ Restricted information');
    await user.click(screen.getByRole('button', { name: 'Check statement' }));
    await screen.findByText('Outside this role');
    expect(screen.queryByRole('heading', { name: 'Suggested wording' })).toBeNull();
  });

  it('shows only API emails in the live source viewer', async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole('heading', { name: 'Northstar Logistics' });
    await user.click(screen.getByRole('button', { name: 'Inbox' }));
    expect(screen.getByText('Account mail')).toBeTruthy();
    expect(screen.queryByText('Design review notes')).toBeNull();
    expect(screen.queryByText('Your ride receipt')).toBeNull();
  });

  it('imports an actual text transcript instead of requesting Speech', async () => {
    const transcribe = vi.spyOn(api, 'transcribe');
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole('heading', { name: 'Northstar Logistics' });
    await user.click(screen.getByRole('button', { name: 'Meeting' }));
    const file = new File(['Actual meeting: Jordan will prepare the readiness review.'], 'review.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => 'Actual meeting: Jordan will prepare the readiness review.' });
    fireEvent.change(screen.getByLabelText('Text transcript file'), { target: { files: [file] } });
    await screen.findByText('Selected: review.txt');
    expect((screen.getByRole('textbox', { name: 'Meeting transcript' }) as HTMLTextAreaElement).value).toContain('Actual meeting');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('refreshes analysis and updates the account brief without losing navigation', async () => {
    vi.spyOn(api, 'refreshBrief').mockResolvedValue({ ...toBrief(demoBriefResponse), brief: 'The latest readiness review is confirmed.' });
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole('heading', { name: 'Northstar Logistics' });
    await user.click(screen.getByRole('button', { name: 'Refresh brief' }));
    await screen.findByText('The latest readiness review is confirmed.');
    expect(api.refreshBrief).toHaveBeenCalledWith('northstar');
  });

  it.each([`/?report=${SAMPLE_REPORT_ID}`, `/reports/${SAMPLE_REPORT_ID}`])('opens a saved report from %s', async (url) => {
    window.history.replaceState({}, '', url);
    render(<App />);
    await screen.findByRole('heading', { name: 'Meeting report' });
    expect(api.getReport).toHaveBeenCalledWith(SAMPLE_REPORT_ID);
  });

  it('handles a malformed legacy report URL as a load error instead of crashing', async () => {
    window.history.replaceState({}, '', '/reports/%ZZ');
    render(<App />);
    await screen.findByRole('alert');
    expect(api.getReport).not.toHaveBeenCalled();
  });

  it('opens internal-source evidence supplied by a brief', async () => {
    const source: PublicSource = { id: 'tracker', accountId: 'northstar', kind: 'internal_app', app: { id: 'tracker', name: 'Implementation Tracker' }, title: 'Setup dependency', author: 'Jordan', occurredAt: '2026-10-03', body: 'Status: Blocked' };
    vi.mocked(api.getSource).mockResolvedValue(source);
    vi.mocked(api.getBrief).mockResolvedValue(toBrief({ ...demoBriefResponse, sources: [source], brief: { summary: 'A dependency is blocked.', items: [{ text: 'Resolve setup', citations: [{ sourceId: source.id, quote: source.body }] }], openQuestions: [] } }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Northstar Logistics' });
    await user.click(screen.getByRole('button', { name: /View: Implementation Tracker: Setup dependency/ }));
    const panel = screen.getByRole('dialog', { name: 'Source evidence' });
    expect(within(panel).getByRole('heading', { name: 'Setup dependency' })).toBeTruthy();
    expect(panel.querySelector('mark')?.textContent).toBe('Status: Blocked');
  });

  it('freezes a pending accepted draft, retries it, and allows an empty description', async () => {
    window.history.replaceState({}, '', `/?report=${SAMPLE_REPORT_ID}`);
    const pending = { ...report(), linearIssueStatus: 'pending' as const, ticketDraft: { ...report().ticketDraft, description: '' } };
    vi.mocked(api.getReport).mockResolvedValue({ report: pending, sources: reportSources(DEMO_TRANSCRIPT) });
    vi.spyOn(api, 'createIssue').mockResolvedValue({ issue: { identifier: 'DEE-1', url: 'https://linear.app/DEE-1' }, alreadyCreated: true });
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole('heading', { name: 'Meeting report' });
    expect((screen.getByRole('textbox', { name: 'Issue title' }) as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Reconcile Linear issue' }));
    await screen.findByText('Created in Linear');
    expect(api.createIssue).toHaveBeenCalledWith(SAMPLE_REPORT_ID, expect.objectContaining({ description: '' }));
  });

  it('loads the saved pending draft after an uncertain result and offers no manual-create link', async () => {
    window.history.replaceState({}, '', `/?report=${SAMPLE_REPORT_ID}`);
    vi.spyOn(api, 'createIssue').mockRejectedValue(new ApiError('Outcome pending', 503));
    const pending = { ...report(), linearIssueStatus: 'pending' as const, ticketDraft: { ...report().ticketDraft, title: 'Accepted draft' } };
    vi.mocked(api.getReport).mockResolvedValueOnce({ report: report(), sources: reportSources(DEMO_TRANSCRIPT) }).mockResolvedValue({ report: pending, sources: reportSources(DEMO_TRANSCRIPT) });
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole('heading', { name: 'Meeting report' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Issue title' }), { target: { value: 'Reviewed edit' } });
    await user.click(screen.getByRole('button', { name: 'Create Linear issue' }));
    await screen.findByRole('button', { name: 'Reconcile Linear issue' });
    const title = screen.getByRole('textbox', { name: 'Issue title' }) as HTMLInputElement;
    expect(title.value).toBe('Accepted draft'); expect(title.disabled).toBe(true);
    expect(screen.queryByRole('link', { name: /prefilled/ })).toBeNull();
  });
});
