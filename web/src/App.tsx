import { useEffect, useMemo, useRef, useState } from 'react';
import { api, isLive } from './api';
import { ACCOUNT_ID, DEMO_TRANSCRIPT, meetingSource } from './demo';
import { ApiError } from './model';
import type { Brief, ChatAnswer, Citation, ClaimCheck, MeetingReport, PublicSource, TicketDraft } from './model';

type View = 'overview' | 'meeting' | 'report' | 'explore';
type EvidenceSelection = { sourceId: string; quote?: string };
type LoadState = 'loading' | 'ready' | 'error';

function BranchMark({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? 'branch-mark branch-mark--small' : 'branch-mark'} viewBox="0 0 68 68" fill="none" aria-hidden="true">
      <circle cx="34" cy="24" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M34 31v17M34 42c-9 0-16-5-18-14M34 42c9 0 16-5 18-14M34 48c-7 1-10 5-11 10M34 48c7 1 10 5 11 10M34 19c-5-6-10-7-15-6M34 19c5-6 10-7 15-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 23c-3 1-5 3-5 6 3 1 6 0 8-3M54 23c3 1 5 3 5 6-3 1-6 0-8-3M17 10c-3-1-5-1-7 1 1 3 4 4 7 4M51 10c3-1 5-1 7 1-1 3-4 4-7 4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="43" r="1.5" fill="currentColor" /><circle cx="56" cy="43" r="1.5" fill="currentColor" />
    </svg>
  );
}

function formatDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EvidenceButtons({ citations, sources, onSelect }: { citations: Citation[]; sources: PublicSource[]; onSelect: (value: EvidenceSelection) => void }) {
  if (!citations.length) return null;
  return (
    <div className="evidence-links" aria-label="Supporting evidence">
      {citations.map((citation, index) => (
        <button key={`${citation.sourceId}-${index}`} type="button" className="evidence-link" onClick={() => onSelect(citation)}>
          View: {sources.find((source) => source.id === citation.sourceId)?.title || 'Source'} <span aria-hidden="true">↗</span>
        </button>
      ))}
    </div>
  );
}

function EvidencePanel({ selection, sources, onClose }: { selection: EvidenceSelection | null; sources: PublicSource[]; onClose: () => void }) {
  const source = sources.find((item) => item.id === selection?.sourceId);
  const quote = selection?.quote;
  const index = source && quote ? source.body.indexOf(quote) : -1;
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selection) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [selection, onClose]);

  if (!selection) return null;
  return (
    <div className="panel-scrim" onMouseDown={onClose}>
      <aside className="evidence-panel" role="dialog" aria-modal="true" aria-label="Source evidence" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-topline"><span className="eyebrow">Source evidence</span><button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close evidence">×</button></div>
        {source ? (
          <>
            <span className="source-kind">{source.kind === 'email' ? 'Email' : 'Transcript'}</span>
            <h2>{source.title}</h2>
            <div className="panel-meta"><span>{source.author}</span><span>{formatDate(source.occurredAt)}</span></div>
            <div className="panel-rule" />
            <p className="panel-caption">Original source excerpt</p>
            <blockquote className="source-body">
              {index >= 0 && quote ? <>{source.body.slice(0, index)}<mark>{quote}</mark>{source.body.slice(index + quote.length)}</> : source.body}
            </blockquote>
            {quote && index < 0 && <p className="notice notice--soft">The cited quote could not be located in this source text.</p>}
          </>
        ) : <div className="empty-state"><h2>Source unavailable</h2><p>This source is not included in the current account view.</p></div>}
      </aside>
    </div>
  );
}

function ErrorNotice({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return <div className="notice notice--error" role="alert">{error.message}{error.status === 401 && <> <a href="/.auth/login/github">Sign in with GitHub</a></>}{error.fallbackUrl && <> <a href={error.fallbackUrl} target="_blank" rel="noreferrer">Open prefilled Linear form ↗</a></>}</div>;
}

function SectionHeading({ kicker, title, description }: { kicker: string; title: string; description?: string }) {
  return <div className="section-heading"><span className="eyebrow">{kicker}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>;
}

function App() {
  const [view, setView] = useState<View>('overview');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [report, setReport] = useState<MeetingReport | null>(null);
  const [reportSources, setReportSources] = useState<PublicSource[]>([]);
  const [transcript, setTranscript] = useState('');
  const [uploadedName, setUploadedName] = useState('');
  const [transcriptionOrigin, setTranscriptionOrigin] = useState<'azure-speech' | 'prepared-fallback' | null>(null);
  const [ticket, setTicket] = useState<TicketDraft | null>(null);
  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null);
  const [pageError, setPageError] = useState<ApiError | null>(null);
  const [meetingError, setMeetingError] = useState<ApiError | null>(null);
  const [reportError, setReportError] = useState<ApiError | null>(null);
  const [issueError, setIssueError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'transcribe' | 'report' | 'issue' | null>(null);
  const [previewIssue, setPreviewIssue] = useState(false);
  const [question, setQuestion] = useState('');
  const [chatAnswer, setChatAnswer] = useState<ChatAnswer | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<ApiError | null>(null);
  const [statement, setStatement] = useState('Our payroll export already supports both US and Canada subsidiaries.');
  const [claimResult, setClaimResult] = useState<ClaimCheck | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<ApiError | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const reportId = new URLSearchParams(window.location.search).get('report');
    const accountId = new URLSearchParams(window.location.search).get('account') || ACCOUNT_ID;
    const load = async () => {
      try {
        const loadedReport = reportId ? await api.getReport(reportId) : null;
        const loadedBrief = await api.getBrief(loadedReport?.report.accountId || accountId);
        if (!active) return;
        setBrief(loadedBrief);
        if (loadedReport) {
          setReport(loadedReport.report);
          setReportSources(loadedReport.sources);
          setTranscript(loadedReport.report.transcript);
          setTicket(structuredClone(loadedReport.report.ticketDraft));
          setView('report');
        }
        setLoadState('ready');
      } catch (error) {
        if (!active) return;
        setPageError(error instanceof ApiError ? error : new ApiError('Could not load the account workspace.'));
        setLoadState('error');
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const sources = useMemo(() => {
    const list = [...(brief?.sources || []), ...reportSources, ...(chatAnswer?.sources || []), ...(claimResult?.sources || [])];
    if (report && !list.some((source) => source.kind === 'meeting')) list.push(meetingSource(report.transcript));
    return [...new Map(list.map((source) => [source.id, source])).values()];
  }, [brief, report, reportSources, chatAnswer, claimResult]);

  const goTo = (next: View) => {
    if (next === 'report' && !report) return;
    setView(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const asApiError = (error: unknown) => error instanceof ApiError ? error : new ApiError('Something went wrong. Please try again.');
  const editTicket = (next: TicketDraft) => { setTicket(next); setPreviewIssue(false); };

  const uploadFile = async (file: File | undefined) => {
    if (!file || !brief) return;
    if (!/\.wav$/i.test(file.name) && !['audio/wav', 'audio/x-wav', 'audio/wave'].includes(file.type)) {
      setMeetingError(new ApiError('Choose a WAV recording to transcribe.', 400));
      return;
    }
    setBusy('transcribe');
    setMeetingError(null);
    setUploadedName(file.name);
    try {
      const result = await api.transcribe(brief.accountId, file);
      setTranscript(result.transcript);
      setTranscriptionOrigin(result.origin);
    } catch (error) {
      setMeetingError(asApiError(error));
    } finally {
      setBusy(null);
    }
  };

  const generateReport = async () => {
    if (!brief || !transcript.trim()) return;
    setBusy('report');
    setReportError(null);
    try {
      const result = await api.createReport(brief.accountId, transcript.trim());
      setReport(result.report);
      setReportSources(result.sources);
      setTicket(structuredClone(result.report.ticketDraft));
      setPreviewIssue(false);
      const url = new URL(window.location.href);
      url.searchParams.set('report', result.report.id);
      window.history.replaceState({}, '', url);
      setView('report');
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      setReportError(asApiError(error));
    } finally {
      setBusy(null);
    }
  };

  const createIssue = async () => {
    if (!report || !ticket || busy || report.linearIssue) return;
    if (!ticket.title.trim() || !ticket.description.trim() || !ticket.acceptanceCriteria.some((item) => item.trim())) {
      setIssueError(new ApiError('Add a title, description, and at least one acceptance criterion.', 400));
      return;
    }
    setBusy('issue');
    setIssueError(null);
    try {
      const result = await api.createIssue(report.id, {
        ...ticket,
        acceptanceCriteria: ticket.acceptanceCriteria.map((item) => item.trim()).filter(Boolean),
      });
      if (isLive) {
        if (!result.issue.identifier || !result.issue.url) throw new ApiError('Linear did not return a working issue link. Please retry.', 502);
        setReport({ ...report, linearIssue: result.issue });
      } else {
        setPreviewIssue(true);
      }
    } catch (error) {
      setIssueError(asApiError(error));
    } finally {
      setBusy(null);
    }
  };

  const askQuestion = async (submitted?: string) => {
    if (!brief || chatBusy) return;
    const value = (submitted || question).trim();
    if (!value) return;
    setQuestion(value);
    setChatBusy(true);
    setChatError(null);
    setChatAnswer(null);
    try {
      setChatAnswer(await api.chat(brief.accountId, value, report?.id));
    } catch (error) {
      setChatError(asApiError(error));
    } finally {
      setChatBusy(false);
    }
  };

  const checkClaim = async () => {
    if (!brief || !statement.trim() || claimBusy) return;
    setClaimBusy(true);
    setClaimError(null);
    setClaimResult(null);
    try {
      setClaimResult(await api.checkClaim(brief.accountId, statement.trim()));
    } catch (error) {
      setClaimError(asApiError(error));
    } finally {
      setClaimBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="header-inner container">
          <button type="button" className="brand" onClick={() => goTo('overview')} aria-label="Deeproot home"><BranchMark small /><span>Deeproot</span></button>
          <nav aria-label="Main navigation" className="main-nav">
            {([['overview', 'Brief'], ['meeting', 'Meeting'], ['report', 'Report'], ['explore', 'Ask & verify']] as const).map(([id, label]) => (
              <button key={id} type="button" className={view === id ? 'nav-link is-active' : 'nav-link'} aria-current={view === id ? 'page' : undefined} onClick={() => goTo(id)} disabled={id === 'report' && !report}>{label}</button>
            ))}
          </nav>
          <div className="header-account">{brief?.accountName || 'Account workspace'}</div>
        </div>
      </header>

      {loadState === 'loading' ? <main id="main-content" className="loading-page" aria-live="polite"><h1>Loading account workspace</h1><p>Gathering the brief and source correspondence.</p></main> :
      loadState === 'error' ? <main id="main-content" className="loading-page"><h1>Account workspace unavailable</h1><ErrorNotice error={pageError} /><button className="button button--primary" type="button" onClick={() => window.location.reload()}>Try again</button></main> :
      <main id="main-content" className="container page-content">
        {view === 'overview' && brief && <>
          <div className="page-lead">
            <SectionHeading kicker="Account brief" title={brief.accountName} description="Review the export request and open questions before processing the meeting." />
            <button type="button" className="button button--primary" onClick={() => goTo('meeting')}>Process meeting <span aria-hidden="true">→</span></button>
          </div>
          <div className="overview-grid">
            <article className="surface brief-card">
              <div className="card-heading"><span className="section-index">01 / Context</span><h2>What we know</h2></div>
              <p className="brief-summary">{brief.brief}</p>
              <div className="divider" />
              <h3>Open questions</h3>
              <ul className="question-list">{brief.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
            <aside className="scope-card" aria-label="Export scope to confirm">
              <span className="section-index">Scope to confirm</span>
              <h2>Hold the Canada date</h2>
              <p>Provincial tax fields and CAD mapping have not been scoped.</p>
              <p className="scope-note">Confirm the work and owner before updating Acme on delivery.</p>
            </aside>
          </div>
          <section className="source-section" aria-labelledby="source-heading">
            <div className="section-top"><div><span className="section-index">02 / Evidence</span><h2 id="source-heading">Source correspondence</h2></div><span className="source-count">{brief.sources.length} emails</span></div>
            <div className="source-grid">{brief.sources.map((source) => <button className="source-card" key={source.id} type="button" onClick={() => setEvidence({ sourceId: source.id })}>
              <span className="source-date">Email · {formatDate(source.occurredAt)} · {source.author}</span>
              <h3>{source.title}</h3>
              <p>{source.body}</p>
              <span className="text-link">Read source <span aria-hidden="true">→</span></span>
            </button>)}</div>
          </section>
        </>}

        {view === 'meeting' && brief && <>
          <div className="page-lead"><SectionHeading kicker={`${brief.accountName} / Meeting`} title="Process meeting" description="Upload a WAV recording or use the prepared transcript. Review the text before generating a report." /></div>
          <div className="meeting-layout">
            <article className="surface upload-card">
              <div className="card-heading"><span className="section-index">Step 1</span><h2>Add a recording</h2></div>
              <div className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadFile(event.dataTransfer.files[0]); }}>
                <p>Drop a WAV file here, or select one from your device.</p>
                <input ref={fileInput} className="sr-only" type="file" accept=".wav,audio/wav,audio/x-wav" aria-label="WAV recording" onChange={(event) => void uploadFile(event.target.files?.[0])} />
                <button type="button" className="button button--secondary" onClick={() => fileInput.current?.click()} disabled={busy !== null}>{busy === 'transcribe' ? 'Transcribing…' : 'Choose WAV file'}</button>
                {uploadedName && <span className="upload-filename">Selected: {uploadedName}</span>}
              </div>
              {transcriptionOrigin && <p className="transcription-origin" role="status">{transcriptionOrigin === 'azure-speech' ? 'Transcription complete. Review it below.' : 'Prepared transcript loaded. Review it below.'}</p>}
              <div className="fallback-row"><span>For the demo:</span><button type="button" onClick={() => { setTranscript(DEMO_TRANSCRIPT); setTranscriptionOrigin('prepared-fallback'); setMeetingError(null); setUploadedName('Prepared transcript'); }}>Use prepared transcript</button></div>
              <ErrorNotice error={meetingError} />
            </article>
            <article className="surface transcript-card">
              <div className="card-heading"><span className="section-index">Step 2</span><h2>Review transcript</h2></div>
              <label className="field" htmlFor="transcript"><span>Meeting transcript</span></label>
              <textarea id="transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="The transcript will appear here. You can also paste or edit text." rows={9} />
              <div className="transcript-actions"><span>{transcript.trim() ? `${transcript.trim().split(/\s+/).length} words` : 'No transcript yet'}</span><button type="button" className="button button--primary" onClick={() => void generateReport()} disabled={!transcript.trim() || busy !== null}>{busy === 'report' ? 'Generating report…' : 'Generate report'} <span aria-hidden="true">→</span></button></div>
              <ErrorNotice error={reportError} />
            </article>
          </div>
          <p className="context-note">The report checks the meeting against Acme’s earlier emails, including the Canada requirement.</p>
        </>}

        {view === 'report' && report && ticket && <>
          <div className="page-lead"><SectionHeading kicker={`${brief?.accountName || 'Account'} / ${formatDate(report.createdAt)}`} title="Meeting report" description="Check each finding against its source, then review the proposed Linear issue." /></div>
          <div className="report-layout">
            <div className="report-main">
              <article className="surface report-summary"><div className="card-heading"><span className="section-index">Summary</span><h2>What happened</h2></div><p className="brief-summary">{report.summary}</p></article>
              <div className="report-columns">
                <article className="surface"><div className="card-heading"><span className="section-index">01</span><h2>Decisions</h2></div>{report.decisions.length ? report.decisions.map((item, index) => <div className="report-item" key={index}><p>{item.text}</p><EvidenceButtons citations={item.citations} sources={sources} onSelect={setEvidence} /></div>) : <p className="muted">No decisions identified.</p>}</article>
                <article className="surface"><div className="card-heading"><span className="section-index">02</span><h2>Open questions</h2></div>{report.openQuestions.length ? <ul className="question-list">{report.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">No open questions identified.</p>}</article>
              </div>
              <article className="surface commitment-card"><div className="card-heading"><span className="section-index">03</span><h2>Commitments</h2></div>{report.commitments.length ? report.commitments.map((item, index) => <div key={index} className="commitment-item"><p>{item.text}</p><div className="fact-row"><div><span className="mini-label">Owner</span><strong>{item.owner || 'Not assigned'}</strong></div><div><span className="mini-label">Due date</span><strong>{item.dueDate ? formatDate(item.dueDate) : 'Not set'}</strong></div></div><EvidenceButtons citations={item.citations} sources={sources} onSelect={setEvidence} /></div>) : <p className="muted">No commitments identified.</p>}</article>
              {report.risks.length > 0 && <article className="surface risk-card"><div className="card-heading"><span className="section-index">04</span><h2>Delivery risks</h2></div>{report.risks.map((risk, index) => <div className="risk-item" key={index}><p>{risk.text}</p><EvidenceButtons citations={risk.citations} sources={sources} onSelect={setEvidence} /></div>)}</article>}
              <article className="follow-up-card"><h2>Suggested follow-up</h2><p>{report.suggestedFollowUp}</p></article>
            </div>
            <aside className="surface ticket-card"><div className="card-heading"><span className="section-index">Next action</span><h2>Linear issue draft</h2></div><p className="ticket-hint">Edit the draft before creating the issue.</p>
              <label className="field"><span>Issue title</span><input value={ticket.title} onChange={(event) => editTicket({ ...ticket, title: event.target.value })} disabled={!!report.linearIssue} /></label>
              <label className="field"><span>Description</span><textarea rows={5} value={ticket.description} onChange={(event) => editTicket({ ...ticket, description: event.target.value })} disabled={!!report.linearIssue} /></label>
              <div className="field"><span>Acceptance criteria</span>{ticket.acceptanceCriteria.map((criterion, index) => <div className="criterion-row" key={index}><textarea rows={2} aria-label={`Acceptance criterion ${index + 1}`} value={criterion} onChange={(event) => editTicket({ ...ticket, acceptanceCriteria: ticket.acceptanceCriteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} disabled={!!report.linearIssue} /><button type="button" aria-label={`Remove criterion ${index + 1}`} onClick={() => editTicket({ ...ticket, acceptanceCriteria: ticket.acceptanceCriteria.filter((_, itemIndex) => itemIndex !== index) })} disabled={!!report.linearIssue}>×</button></div>)}<button className="text-button" type="button" onClick={() => editTicket({ ...ticket, acceptanceCriteria: [...ticket.acceptanceCriteria, ''] })} disabled={!!report.linearIssue}>+ Add criterion</button></div>
              <label className="field"><span>Priority</span><select value={ticket.priority} onChange={(event) => editTicket({ ...ticket, priority: event.target.value as TicketDraft['priority'] })} disabled={!!report.linearIssue}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              <ErrorNotice error={issueError} />
              {report.linearIssue ? <div className="issue-success" role="status"><strong>Created in Linear</strong><a href={report.linearIssue.url} target="_blank" rel="noreferrer">Open {report.linearIssue.identifier} ↗</a></div> : previewIssue ? <div className="issue-success" role="status"><strong>Demo preview ready</strong><span>No issue was created. Connect the API to create one in Linear.</span></div> : <button type="button" className="button button--primary ticket-submit" onClick={() => void createIssue()} disabled={busy !== null}>{busy === 'issue' ? 'Creating issue…' : isLive ? 'Create Linear issue' : 'Preview issue'}</button>}
            </aside>
          </div>
          <div className="inline-next">Need another detail? <button className="text-button" type="button" onClick={() => goTo('explore')}>Ask and verify <span aria-hidden="true">→</span></button></div>
        </>}

        {view === 'explore' && brief && <>
          <div className="page-lead"><SectionHeading kicker={`${brief.accountName} / Evidence tools`} title="Ask and verify" description="Get sourced answers and check draft statements against this account’s records." /></div>
          <div className="explore-grid">
            <article className="surface tool-card"><div className="card-heading"><span className="section-index">Account question</span><h2>Ask about the account</h2></div><p>Answers use the permitted emails and available meeting report.</p><form onSubmit={(event) => { event.preventDefault(); void askQuestion(); }}><label className="field" htmlFor="question"><span>Your question</span></label><textarea id="question" rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What does Acme need from the export?" /><button type="submit" className="button button--primary" disabled={!question.trim() || chatBusy}>{chatBusy ? 'Finding sources…' : 'Ask question'}</button></form><div className="suggestions"><span className="mini-label">Try a question</span><button type="button" onClick={() => void askQuestion('What is the Canada gap?')}>What is the Canada gap?</button><button type="button" onClick={() => void askQuestion('Who owns the export?')}>Who owns the export?</button></div><ErrorNotice error={chatError} />{chatAnswer && <div className="tool-result" aria-live="polite"><h3>Answer</h3><p>{chatAnswer.answer}</p><EvidenceButtons citations={chatAnswer.citations} sources={sources} onSelect={setEvidence} /></div>}</article>
            <article className="surface tool-card"><div className="card-heading"><span className="section-index">Claim check</span><h2>Check a statement</h2></div><p>Compare client-facing wording with the available evidence.</p><form onSubmit={(event) => { event.preventDefault(); void checkClaim(); }}><label className="field" htmlFor="statement"><span>Draft statement</span></label><textarea id="statement" rows={3} value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="Write a statement to verify…" /><button type="submit" className="button button--secondary" disabled={!statement.trim() || claimBusy}>{claimBusy ? 'Checking sources…' : 'Check statement'}</button></form><ErrorNotice error={claimError} />{claimResult && <div className="tool-result" aria-live="polite"><span className={`verdict verdict--${claimResult.verdict}`}>{claimResult.verdict[0].toUpperCase() + claimResult.verdict.slice(1)}</span><p>{claimResult.explanation}</p><EvidenceButtons citations={claimResult.citations} sources={sources} onSelect={setEvidence} /><div className="rewrite"><h3>Suggested wording</h3><p>{claimResult.suggestedRewrite}</p></div></div>}</article>
          </div>
          <p className="privacy-note">Account permissions are checked by the server before sources are retrieved.</p>
        </>}
      </main>}
      <footer className="site-footer"><div className="container footer-inner"><span>Deeproot</span><span>GirlHacks 2026</span></div></footer>
      <EvidencePanel selection={evidence} sources={sources} onClose={() => setEvidence(null)} />
    </div>
  );
}

export default App;
