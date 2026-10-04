import { useEffect, useState } from 'react';
import type { DemoAppRecord, IntegrationStatus, IntegrationsResponse } from '@deeproot/shared';
import { api, isLive } from './api';

function SampleRecord({ accountId, appId, record, onSaved }: { accountId: string; appId: string; record: DemoAppRecord; onSaved: () => Promise<void> }) {
  const tracker = appId === 'impl-tracker';
  const [changes, setChanges] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const value = (field: string) => String(changes[field] ?? record.raw[field] ?? '');
  const field = (key: string, label: string, type = 'text') => <label className="field"><span>{label}</span><input type={type} value={value(key)} onChange={e => { setChanges({ ...changes, [key]: type === 'number' ? Number(e.target.value) : e.target.value }); setSaved(false); }} disabled={busy} /></label>;
  return <form className="sample-record" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void api.editDemoRecord(accountId, appId, record, changes).then(async () => { await onSaved(); setChanges({}); setSaved(true); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>
    <div className="card-heading"><span className="section-index">{record.id} · revision {record.revision}</span><h3>{String(record.raw[tracker ? 'summary' : 'setting'])}</h3></div>
    <label className="field"><span>{tracker ? 'Tracker status' : 'Configuration status'}</span><select value={value(tracker ? 'status' : 'state')} onChange={e => { setChanges({ ...changes, [tracker ? 'status' : 'state']: e.target.value }); setSaved(false); }} disabled={busy}>{(tracker ? ['Blocked', 'In progress', 'Complete'] : ['INCOMPLETE', 'IN_PROGRESS', 'COMPLETE']).map(v => <option key={v}>{v}</option>)}</select></label>
    {tracker ? <>{field('assignee', 'Assignee')}{field('due_date', 'Dependency due', 'date')}{field('go_live', 'Go-live date', 'date')}{field('notes', 'Implementation notes')}</> : <>{field('employees_affected', 'Employees affected', 'number')}<label className="field"><span>Missing configuration items (comma separated)</span><input value={(changes.missing as string[] | undefined ?? record.raw.missing as string[] ?? []).join(', ')} onChange={e => { setChanges({ ...changes, missing: e.target.value.split(',').map(v => v.trim()).filter(Boolean) }); setSaved(false); }} disabled={busy} /></label>{field('comment', 'Readiness comment')}</>}
    <button type="submit" className="button button--secondary" disabled={busy || !Object.keys(changes).length}>{busy ? 'Saving…' : 'Save in sample tool'}</button>
    <button type="button" className="text-button" disabled={busy} onClick={() => { setBusy(true); void api.deleteDemoRecord(accountId, appId, record).then(onSaved).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Remove sample record</button>
    {saved && <p className="notice notice--soft" role="status">Saved upstream. Sync the connector to update Deeproot.</p>}{error && <p role="alert" className="notice notice--error">{error}</p>}
  </form>;
}
export function IntegrationsPanel({ accountId, onSynced }: { accountId: string; onSynced: (ids: string[]) => Promise<void> }) {
  const [data, setData] = useState<IntegrationsResponse | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const [records, setRecords] = useState<Record<string, DemoAppRecord[]>>({}); const [newTitles, setNewTitles] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const load = async () => { const d = await api.getIntegrations(accountId); setData(d); return d; };
  useEffect(() => { let active = true; api.getIntegrations(accountId).then(d => { if (active) setData(d); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [accountId]);
  const open = async (appId: string) => setRecords(r => ({ ...r, [appId]: [] }));
  const reloadRecords = async (appId: string) => { const rows = await api.getDemoRecords(accountId, appId); setRecords(r => ({ ...r, [appId]: rows })); };
  const upstreamSaved = async (appId: string) => { await reloadRecords(appId); setNotice('Saved upstream. Sync the connector to update Deeproot.'); };
  const sync = async (status: IntegrationStatus) => {
    setBusy(status.appId); setError(''); setNotice('');
    try { const result = await api.syncIntegration(accountId, status.appId); await load();
      try { await onSynced(result.changedSourceIds ?? []); }
      catch { throw new Error('Records synced, but the brief could not refresh. Check model availability and use Refresh brief.'); }
      setNotice(`${status.name}: ${result.accepted ?? 0} records synced. Brief refreshed from current evidence.`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sync could not finish.'); await load().catch(() => undefined); }
    finally { setBusy(''); }
  };
  return <>
    <div className="integration-proof"><span className="eyebrow">From internal apps to evidence</span><h1>Connected apps</h1><p>Change a record upstream. Sync it. See the brief and cited answer change.</p><div className="proof-path"><span>① Edit source</span><span>② HTTP sync</span><span>③ Inspect evidence</span><span>④ Ask & verify</span></div></div>
    <p className="context-note">Sample tools and records are fictional. These APIs demonstrate the connector workflow; no ADP tenant is connected. Only delivery status and aggregate readiness belong here.</p>
    {error && <p className="notice notice--error" role="alert">{error}<button type="button" className="text-button" onClick={() => { setError(''); void load().catch(e => setError(e.message)); }}>Retry status</button></p>}
    {notice && <p className="notice notice--soft" role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading connector status…</p>}
    {data && !data.integrations.length && <p className="surface">{isLive ? 'No registered connectors.' : 'Use the local live API to run the editable sample tools and HTTP integration demo.'}</p>}
    <div className="integration-grid">{data?.integrations.map(status => <article className={`surface integration-card integration-card--${status.state}`} key={status.appId}>
      <span className="eyebrow">{status.sample ? 'Sample internal system' : 'Internal-app connector'}</span><h2>{status.name}</h2><span className="connection-state">{status.state.replaceAll('_', ' ')}</span>
      <p className="context-note">Access: {status.accessMode === 'source' ? 'Upstream document permissions' : 'Account team — source permissions are not synchronized'}</p>
      <dl className="sync-stats"><div><dt>Last successful sync</dt><dd>{status.lastSuccessfulSync ? new Date(status.lastSuccessfulSync).toLocaleString() : 'Not synced yet'}</dd></div><div><dt>Accepted / rejected</dt><dd>{status.accepted ?? '—'} / {status.rejected ?? '—'}</dd></div></dl>
      {status.error && <p className="notice notice--error">{status.error}</p>}
      <div className="integration-actions"><button type="button" className="button button--primary" disabled={!status.configured || !!busy} onClick={() => void sync(status)}>{busy === status.appId ? 'Syncing and refreshing…' : 'Sync into Deeproot'}</button>
      {data.demoAppsEnabled && status.sample && <button type="button" className="button button--secondary" onClick={() => { setError(''); void open(status.appId).then(() => reloadRecords(status.appId)).catch(e => setError(e.message)); }}>Open sample tool</button>}</div>
      {records[status.appId] && <div className="sample-tool"><p className="mini-label">Editable upstream records · Separate from Deeproot’s source index</p>{records[status.appId]!.map(record => <SampleRecord key={`${record.id}-${record.revision}`} accountId={accountId} appId={status.appId} record={record} onSaved={() => upstreamSaved(status.appId)} />)}<form className="sample-record" onSubmit={e => { e.preventDefault(); setBusy(status.appId); void api.createDemoRecord(accountId, status.appId, newTitles[status.appId] ?? "").then(() => reloadRecords(status.appId)).then(() => setNewTitles(v => ({ ...v, [status.appId]: "" }))).catch(e => setError(e.message)).finally(() => setBusy("")); }}><label className="field"><span>New sample record title</span><input value={newTitles[status.appId] ?? ""} maxLength={200} onChange={e => setNewTitles(v => ({ ...v, [status.appId]: e.target.value }))} /></label><button type="submit" className="button button--secondary" disabled={!!busy || !newTitles[status.appId]?.trim()}>Add sample record</button></form><button type="button" className="text-button" onClick={() => { void api.resetDemoRecords(accountId, status.appId).then(() => reloadRecords(status.appId)).then(() => setNotice('Sample records reset upstream. Sync to update Deeproot.')).catch(e => setError(e.message)); }} disabled={!!busy}>Reset fictional records</button></div>}
    </article>)}</div>
  </>;
}
