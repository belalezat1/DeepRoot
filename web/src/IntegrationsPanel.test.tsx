// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { IntegrationsPanel } from './IntegrationsPanel';
const status = { appId: 'impl-tracker', name: 'Implementation Tracker', configured: true, sample: true, accessMode: 'account' as const, state: 'ready' as const };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('integration proof interface', () => {
  it('edits the upstream tool separately and refreshes evidence only after sync', async () => {
    const original = { id: 'IT-5120', revision: 0, raw: { summary: 'Dependency', status: 'Blocked', assignee: '', due_date: '2026-10-08', go_live: '2026-10-22', notes: 'Tax setup remains incomplete.' } };
    vi.spyOn(api, 'getIntegrations').mockResolvedValue({ integrations: [status], demoAppsEnabled: true });
    vi.spyOn(api, 'getDemoRecords').mockResolvedValueOnce([original]).mockResolvedValue([{ ...original, revision: 1, raw: { ...original.raw, assignee: 'Sam' } }]);
    vi.spyOn(api, 'editDemoRecord').mockResolvedValue(undefined);
    vi.spyOn(api, 'syncIntegration').mockResolvedValue({ ...status, state: 'synced', accepted: 1, rejected: 0, changedSourceIds: ['source-id'] });
    const refreshed = vi.fn(async () => {}), user = userEvent.setup(); render(<IntegrationsPanel accountId="northstar" onSynced={refreshed} />);
    await user.click(await screen.findByRole('button', { name: 'Open sample tool' }));
    await user.type(await screen.findByRole('textbox', { name: 'Assignee' }), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Save in sample tool' }));
    await screen.findByText('Saved upstream. Sync the connector to update Deeproot.');
    expect(refreshed).not.toHaveBeenCalled(); expect(api.syncIntegration).not.toHaveBeenCalled();
    expect(api.editDemoRecord).toHaveBeenCalledWith('northstar', 'impl-tracker', original, { assignee: 'Sam' });
    await user.click(screen.getByRole('button', { name: 'Sync into Deeproot' }));
    await screen.findByText(/1 records synced/); expect(refreshed).toHaveBeenCalledWith(['source-id']);
  });
  it('reports a successful sync with failed model refresh honestly', async () => {
    vi.spyOn(api, 'getIntegrations').mockResolvedValue({ integrations: [status], demoAppsEnabled: false });
    vi.spyOn(api, 'syncIntegration').mockResolvedValue({ ...status, state: 'synced', accepted: 1 });
    const user = userEvent.setup(); render(<IntegrationsPanel accountId="northstar" onSynced={async () => { throw new Error('Model unavailable'); }} />);
    await user.click(await screen.findByRole('button', { name: 'Sync into Deeproot' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Records synced, but the brief could not refresh.');
    expect(screen.queryByText(/Brief refreshed from current evidence/)).toBeNull();
  });
});
