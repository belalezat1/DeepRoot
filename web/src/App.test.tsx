// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  window.scrollTo = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  sessionStorage.setItem('deeproot-opening-seen', 'yes');
  localStorage.removeItem('deeproot-effects');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Deeproot frontend demo flow', () => {
  it('opens a mock inbox and previews the same Acme emails and reviewed meeting used for analysis', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Acme Corporation' });
    expect(screen.getByRole('heading', { name: 'Account summary' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Questions to resolve' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Account emails' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Process meeting' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Inbox' }));
    const context = screen.getByRole('complementary', { name: 'Analysis context' });
    expect(within(context).getByRole('heading', { name: 'Acme Corporation sources' })).toBeTruthy();
    expect(within(context).getByText('Awaiting transcript')).toBeTruthy();
    expect(within(context).getByText('Payroll export requirements')).toBeTruthy();
    expect(within(context).queryByText('Design review notes')).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Search mail' }), 'Payroll export requirements');
    const mailbox = screen.getByRole('region', { name: 'Mailbox' });
    await user.click(within(mailbox).getByText('Payroll export requirements').closest('button')!);
    expect(within(mailbox).getByText(/both our US and Canada subsidiaries/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Meeting' }));
    await user.click(screen.getByRole('button', { name: /Use prepared transcript/ }));
    await user.click(screen.getByRole('button', { name: 'Inbox' }));
    expect(within(screen.getByRole('complementary', { name: 'Analysis context' })).getByText('Reviewed transcript ready')).toBeTruthy();
  });

  it('uses static content when the device requests reduced motion', async () => {
    sessionStorage.removeItem('deeproot-opening-seen');
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<App />);
    await screen.findByRole('heading', { name: 'Acme Corporation' });
    expect(screen.queryByRole('dialog', { name: 'Welcome to Deeproot' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Enchanted effects reduced by device setting' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('.fox-companion:not(.is-animated)')).toBeTruthy();
  });

  it('can skip the opening, pause effects, and dismiss evidence with a right swipe', async () => {
    sessionStorage.removeItem('deeproot-opening-seen');
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('dialog', { name: 'Welcome to Deeproot' })).toBeTruthy();
    const opening = screen.getByRole('dialog', { name: 'Welcome to Deeproot' });
    await user.click(screen.getByRole('button', { name: /Skip intro/ }));
    await waitForElementToBeRemoved(opening);
    await screen.findByRole('heading', { name: 'Acme Corporation' });
    await user.click(screen.getByRole('button', { name: /Re: Acme export scope/ }));
    const panel = screen.getByRole('dialog', { name: 'Source evidence' });
    const handle = panel.querySelector('.panel-swipe-handle')!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 45, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 205, clientY: 47, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 205, clientY: 47, pointerId: 1 });
    expect(screen.queryByRole('dialog', { name: 'Source evidence' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pause enchanted effects' }));
    expect(screen.getByRole('button', { name: 'Resume enchanted effects' })).toBeTruthy();
  });

  it('opens the exact email source from an evidence card', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'Acme Corporation' });
    await user.click(screen.getByRole('button', { name: /Re: Acme export scope/ }));

    const panel = screen.getByRole('dialog', { name: 'Source evidence' });
    expect(within(panel).getByRole('heading', { name: 'Re: Acme export scope' })).toBeTruthy();
    expect(within(panel).getByText(/the current payroll export only supports the US subsidiary/)).toBeTruthy();
    const close = within(panel).getByRole('button', { name: 'Close evidence' });
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.click(close);
    expect(screen.queryByRole('dialog', { name: 'Source evidence' })).toBeNull();
  });

  it('keeps transcript and ticket edits, opens citations, and previews rather than claiming a real issue', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Acme Corporation' });

    await user.click(screen.getByRole('button', { name: 'Meeting' }));
    await user.click(screen.getByRole('button', { name: /Use prepared transcript/ }));
    const transcript = screen.getByRole('textbox', { name: 'Meeting transcript' }) as HTMLTextAreaElement;
    fireEvent.change(transcript, { target: { value: transcript.value.replace('by Friday.', 'by Friday afternoon.') } });
    expect(transcript.value).toContain('Friday afternoon');
    await user.click(screen.getByRole('button', { name: /Generate report/ }));

    await screen.findByRole('heading', { name: 'Meeting report' });
    expect(screen.getByText('Not assigned')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /View: Re: Acme export scope/ })[0]);
    const panel = screen.getByRole('dialog', { name: 'Source evidence' });
    expect(panel.querySelector('mark')?.textContent).toContain('payroll export');
    await user.click(within(panel).getByRole('button', { name: 'Close evidence' }));

    const issueTitle = screen.getByRole('textbox', { name: 'Issue title' }) as HTMLInputElement;
    fireEvent.change(issueTitle, { target: { value: 'Deliver reviewed US and Canada export' } });
    expect(issueTitle.value).toBe('Deliver reviewed US and Canada export');
    const firstCriterion = screen.getByRole('textbox', { name: 'Acceptance criterion 1' }) as HTMLTextAreaElement;
    expect(firstCriterion.value).toContain('both US and Canada subsidiaries');
    await user.click(screen.getByRole('button', { name: /Preview issue/ }));
    await screen.findByText('Demo preview ready');
    expect(screen.queryByText('Created in Linear')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Inbox' }));
    const context = screen.getByRole('complementary', { name: 'Analysis context' });
    expect(within(context).getAllByText('Cited in report').length).toBeGreaterThan(0);
    expect(within(context).getByRole('button', { name: /Review cited report/ })).toBeTruthy();
  });

  it('flags the overconfident claim and gives no restricted-account source', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Acme Corporation' });
    await user.click(screen.getByRole('button', { name: 'Ask & verify' }));

    await user.click(screen.getByRole('button', { name: /Check statement/ }));
    await screen.findByText('Contradicted');
    expect(screen.getByText(/current export supports only the US subsidiary/)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'What is in the BetaCo payroll record?' } });
    await user.click(screen.getByRole('button', { name: /Ask question/ }));
    await screen.findByText('I cannot answer that from this account workspace.');
    expect(screen.queryByText(/BLUEHERON|Confidential: BetaCo/)).toBeNull();
  });
});
