import { useMemo, useState } from 'react';
import { reportCitations } from '@deeproot/shared';
import { authorName, formatDate } from './format';
import type { MeetingReport, PublicSource } from './model';

type Mail = {
  id: string;
  sender: string;
  subject: string;
  body: string;
  date: string;
  sourceId?: string;
};

const EVERYDAY_MAIL: Mail[] = [
  { id: 'demo-design', sender: 'Nora Patel', subject: 'Design review notes', date: '2026-10-02T13:20:00Z', body: 'Hi team,\n\nThe latest design review is ready. I left comments on the account dashboard mockups for our next sync.\n\nThanks,\nNora' },
  { id: 'demo-receipt', sender: 'Transit Receipts', subject: 'Your ride receipt', date: '2026-10-02T08:05:00Z', body: 'Thanks for riding. Your receipt for the morning trip is attached in this fictional demo mailbox.' },
  { id: 'demo-calendar', sender: 'Calendar', subject: 'Tomorrow: team planning', date: '2026-10-01T09:15:00Z', body: 'Reminder: team planning starts tomorrow at 10:00 AM.\n\nThis is a fictional message in the Deeproot demo mailbox.' },
  { id: 'demo-design-system', sender: 'Maya Chen', subject: 'Updated component library', date: '2026-09-30T16:45:00Z', body: 'The component library updates are ready for review. I included the latest navigation and form patterns.\n\nMaya' },
  { id: 'demo-product', sender: 'Eli Brooks', subject: 'Product notes for October', date: '2026-09-29T12:10:00Z', body: 'Sharing the October product notes ahead of our Monday planning session.\n\nBest,\nEli' },
  { id: 'demo-lunch', sender: 'Sam Rivera', subject: 'Lunch on Thursday?', date: '2026-09-27T17:25:00Z', body: 'A few of us are grabbing lunch after the morning workshop on Thursday. Let me know if you can make it.\n\nSam' },
  { id: 'demo-workshop', sender: 'Learning Team', subject: 'Workshop materials are ready', date: '2026-09-26T11:40:00Z', body: 'The workshop agenda and reading materials are available in the demo workspace. This is a fictional inbox message.' },
  { id: 'demo-welcome', sender: 'Workspace Team', subject: 'Welcome to your workspace', date: '2026-09-25T10:30:00Z', body: 'Your demo workspace is ready. Open the Northstar threads to inspect the account context.\n\nThis is a fictional message for the hackathon demo.' },
];

export function InboxView({ accountName, sources, transcript, report, onMeeting, onReport, mock = true }: { accountName: string; sources: PublicSource[]; transcript: string; report: MeetingReport | null; onMeeting: () => void; onReport: () => void; mock?: boolean }) {
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<'inbox' | 'starred'>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stars, setStars] = useState(() => new Set(sources.map((source) => source.id)));

  const emailSources = sources.filter((source) => source.kind === 'email');
  const mail = useMemo(() => [
    ...sources.filter((source) => source.kind === 'email').map((source) => ({ id: source.id, sourceId: source.id, sender: authorName(source.author), subject: source.title, body: source.body, date: source.occurredAt })),
    ...(mock ? EVERYDAY_MAIL : []),
  ].sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf()), [sources, mock]);
  const visible = mail.filter((message) => {
    if (folder === 'starred' && !stars.has(message.id)) return false;
    const query = search.trim().toLowerCase();
    return !query || `${message.sender} ${message.subject} ${message.body}`.toLowerCase().includes(query);
  });
  const selected = mail.find((message) => message.id === selectedId);
  const cited = new Set(report ? reportCitations(report).map((c) => c.sourceId) : []);

  const toggleStar = (id: string) => setStars((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <div className="inbox-scene">
    <div className="inbox-topbar">
      <div className="inbox-brand"><span className="inbox-mark" aria-hidden="true">M</span><strong>{mock ? 'Gmail' : 'Account mail'}</strong><span className="inbox-demo-label">{mock ? 'Demo mailbox' : 'Source viewer'}</span></div>
      <label className="inbox-search"><span aria-hidden="true">⌕</span><span className="sr-only">Search mail</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search mail" aria-label="Search mail" /></label>
      <span className="inbox-avatar" aria-label="Demo account">D</span>
    </div>
    <div className="inbox-layout">
      <aside className="inbox-sidebar" aria-label="Mail folders">
        <button type="button" className={folder === 'inbox' ? 'is-current' : ''} aria-current={folder === 'inbox' ? 'page' : undefined} onClick={() => { setFolder('inbox'); setSelectedId(null); }}><span aria-hidden="true">✉</span> Inbox <span>{mail.length}</span></button>
        <button type="button" className={folder === 'starred' ? 'is-current' : ''} aria-current={folder === 'starred' ? 'page' : undefined} onClick={() => { setFolder('starred'); setSelectedId(null); }}><span aria-hidden="true">☆</span> Starred <span>{stars.size}</span></button>
        <div className="inbox-sidebar-note">{mock ? 'Fictional messages. No Gmail account is connected.' : 'Emails returned by Deeproot. This viewer does not connect to your mailbox.'}</div>
      </aside>
      <section className="inbox-main" aria-label="Mailbox">
        {selected ? <>
          <div className="inbox-toolbar"><button type="button" onClick={() => setSelectedId(null)} aria-label="Back to inbox">←</button><span>{selected.sourceId ? 'Account email' : 'Inbox message'}</span></div>
          <article className="inbox-message"><div className="inbox-message-top"><h1>{selected.subject}</h1>{selected.sourceId && <span className="inbox-context-tag">Report source</span>}</div><div className="inbox-message-meta"><span className="mail-avatar" aria-hidden="true">{selected.sender[0]}</span><div><strong>{selected.sender}</strong><small>{sources.find((source) => source.id === selected.sourceId)?.author || 'demo@example.com'}</small></div><time dateTime={selected.date}>{formatDate(selected.date, true)}</time></div><div className="inbox-message-body">{selected.body}</div>{selected.sourceId && <button type="button" className="inbox-message-action" onClick={onMeeting}>Open meeting <span aria-hidden="true">→</span></button>}</article>
        </> : <>
          <div className="inbox-toolbar"><strong>{folder === 'inbox' ? 'Inbox' : 'Starred'}</strong><span>{visible.length} messages</span></div>
          <div className="inbox-message-list">{visible.length ? visible.map((message) => <div className={message.sourceId ? 'inbox-row is-context' : 'inbox-row'} key={message.id}>
            <button className={stars.has(message.id) ? 'inbox-star is-starred' : 'inbox-star'} type="button" onClick={() => toggleStar(message.id)} aria-pressed={stars.has(message.id)} aria-label={`${stars.has(message.id) ? 'Unstar' : 'Star'} ${message.subject}`}>{stars.has(message.id) ? '★' : '☆'}</button>
            <button className="inbox-row-open" type="button" onClick={() => setSelectedId(message.id)}><span className="inbox-row-sender">{message.sender}</span><span className="inbox-row-subject">{message.subject}<span className="inbox-snippet">{message.body.replace(/\s+/g, ' ').slice(0, 95)}</span></span>{message.sourceId && <span className="inbox-context-dot" aria-label="Report source" title="Report source" />}<time dateTime={message.date}>{formatDate(message.date, true)}</time></button>
          </div>) : <div className="inbox-no-results">No messages match your search.</div>}</div>
        </>}
      </section>
      <aside className="inbox-context" aria-label="Analysis context">
        <span className="fox-perch fox-perch--context" data-fox-perch aria-hidden="true" />
        <div className="inbox-context-heading"><span className="inbox-context-eyebrow">Deeproot sources</span><h2>{accountName} sources</h2><p>{emailSources.length} emails and meeting transcript</p></div>
        <div className="inbox-context-list">
          {emailSources.map((source) => <button type="button" key={source.id} onClick={() => setSelectedId(source.id)}><span className="context-icon" aria-hidden="true">✉</span><span><strong>{source.title}</strong><small>{cited.has(source.id) ? 'Cited in report' : 'Available for report'}</small></span><span aria-hidden="true">↗</span></button>)}
          <button type="button" onClick={onMeeting}><span className="context-icon" aria-hidden="true">▤</span><span><strong>Meeting transcript</strong><small>{transcript.trim() ? sources.some((source) => source.kind === 'meeting' && source.body === report?.transcript && cited.has(source.id)) ? 'Cited in report' : 'Reviewed transcript ready' : 'Awaiting transcript'}</small></span><span aria-hidden="true">↗</span></button>
        </div>
        {transcript.trim() && <div className="inbox-transcript-peek"><strong>Transcript excerpt</strong><p>{transcript.trim().slice(0, 150)}{transcript.trim().length > 150 ? '…' : ''}</p></div>}
        <button type="button" className="inbox-context-cta" onClick={report ? onReport : onMeeting}>{report ? 'Review cited report' : 'Continue to meeting'} <span aria-hidden="true">→</span></button>
      </aside>
    </div>
  </div>;
}
