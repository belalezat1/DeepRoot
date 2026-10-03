// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Deeproot frontend demo flow', () => {
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
