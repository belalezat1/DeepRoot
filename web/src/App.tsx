import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { CopyButton } from "./CopyButton";
import { InvestigationSteps } from "./InvestigationSteps";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { ReportComparison } from "./ReportComparison";
import { api, isLive } from './api';
import { ACCOUNT_ID, DEMO_TRANSCRIPT } from './demo';
import { ButterflyCursor, FireflyField, ForestOpening, FoxCompanion, useEnchantedMotion, useSectionReveals } from './EnchantedEffects';
import { InboxView } from './InboxView';
import { ApiError } from './model';
import type { Brief, ClaimCheck, MeetingReport, PublicSource, TicketDraft } from './model';

import { EvidenceButtons, EvidencePanel, type EvidenceSelection } from './EvidencePanel';
import { authorName, formatDate } from './format';
import { AskPanel, type ChatTurn } from './AskPanel';
import { WorkflowStrip } from './WorkflowStrip';

type View = 'overview' | 'inbox' | 'meeting' | 'report' | 'explore' | 'apps';
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

function sourcePreview(body: string) {
  const paragraphs = body.trim().split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const first = paragraphs.find((part) => !/^(hi|hello|dear)\b[^\n]*,?$/i.test(part)) || paragraphs[0] || '';
  return first.replace(/\s+/g, ' ');
}

function ErrorNotice({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return <div className="notice notice--error" role="alert">{error.message}{error.status === 401 && <> <a href="/.auth/login/github">Sign in with GitHub</a></>}{error.fallbackUrl && <> <a href={error.fallbackUrl} target="_blank" rel="noreferrer">Open prefilled Linear form ↗</a></>}</div>;
}

function WorkingGlyph() {
  return <span className="working-glyph" aria-hidden="true">✦</span>;
}

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return <div className="section-heading"><span className="eyebrow">{kicker}</span><h1>{title}</h1></div>;
}

function App() {
  const magic = useEnchantedMotion();
  const [view, setView] = useState<View>('overview');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [report, setReport] = useState<MeetingReport | null>(null);
  const [previousReport, setPreviousReport] = useState<MeetingReport | null>(null);
  const [changedIds, setChangedIds] = useState<string[]>([]);
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
  const [busy, setBusy] = useState<'transcribe' | 'import' | 'report' | 'issue' | null>(null);
  const [previewIssue, setPreviewIssue] = useState(false);
  const [question, setQuestion] = useState('');
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<ApiError | null>(null);
  const [statement, setStatement] = useState('Northstar’s October 15 payroll launch is on track and state tax setup is complete.');
  const [claimResult, setClaimResult] = useState<ClaimCheck | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<ApiError | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<ApiError | null>(null);
  const [briefRefreshed, setBriefRefreshed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);

  useSectionReveals(`${view}-${loadState}`, magic.animate);

  useEffect(() => {
    let active = true;
    const legacyReportId = /^\/reports\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
    const queryReportId = new URLSearchParams(window.location.search).get('report');
    const accountId = new URLSearchParams(window.location.search).get('account') || ACCOUNT_ID;
    const load = async () => {
      try {
        const reportId = queryReportId || (legacyReportId ? decodeURIComponent(legacyReportId) : null);
        const loadedReport = reportId ? await api.getReport(reportId) : null;
        const loadedBrief = await api.getBrief(loadedReport?.report.accountId || accountId);
        if (!active) return;
        setBrief(loadedBrief);
        if (loadedBrief.accountId !== ACCOUNT_ID) setStatement('');
        if (loadedReport) {
          setReport(loadedReport.report);
          setReportSources(loadedReport.sources);
          setTranscript(loadedReport.report.transcript);
          setTicket(structuredClone(loadedReport.report.ticketDraft));
          if (loadedReport.report.previousReportId) { const previous = await api.getReport(loadedReport.report.previousReportId).catch(() => null); if (active && previous) setPreviousReport(previous.report); }
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
    const list = [...(brief?.sources || []), ...reportSources, ...chatTurns.flatMap((turn) => turn.answer.sources), ...(claimResult?.sources || [])];
    return [...new Map(list.map((source) => [`${source.id}:${source.version ?? "legacy"}`, source])).values()];
  }, [brief, reportSources, chatTurns, claimResult]);

  const goTo = (next: View) => {
    if (next === 'report' && !report) return;
    setView(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const asApiError = (error: unknown) => error instanceof ApiError ? error : new ApiError('Something went wrong. Please try again.');
  const closeEvidence = useCallback(() => setEvidence(null), []);
  const ticketLocked = report?.ticketStatus === 'none' || !!report?.linearIssue || report?.linearIssueStatus === 'pending' || busy === 'issue';
  const issueAction = isLive ? (report?.linearIssueStatus === 'pending' ? 'Reconcile Linear issue' : 'Create Linear issue') : 'Preview issue';
  const editTicket = (next: TicketDraft) => { setTicket(next); setPreviewIssue(false); };

  const uploadFile = async (file: File | undefined) => {
    if (!file || !brief || busy) return;
    if (!/\.mp4$/i.test(file.name)) {
      setMeetingError(new ApiError('Choose an MP4 meeting recording to transcribe.', 400));
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

  const importTranscript = async (file: File | undefined) => {
    if (!file || busy) return;
    setMeetingError(null);
    if (!/\.txt$/i.test(file.name) || file.size > 200_000) {
      setMeetingError(new ApiError('Choose a plain-text (.txt) transcript under 200 KB.', 400));
      return;
    }
    try {
      setBusy('import');
      const value = await file.text();
      if (!value.trim() || value.length > 20_000 || value.includes('\u0000')) throw new ApiError('Choose a non-empty text transcript with at most 20,000 characters.', 400);
      setTranscript(value);
      setUploadedName(file.name);
      setTranscriptionOrigin(null);
    } catch (error) { setMeetingError(asApiError(error)); }
    finally { setBusy(null); }
  };

  const refreshBrief = async () => {
    if (!brief || briefBusy) return;
    setBriefBusy(true); setBriefError(null); setBriefRefreshed(false);
    try { setBrief(await api.refreshBrief(brief.accountId)); setBriefRefreshed(true); }
    catch (error) { setBriefError(asApiError(error)); }
    finally { setBriefBusy(false); }
  };

  const generateReport = async () => {
    if (!brief || !transcript.trim() || busy) return;
    setBusy('report');
    setReportError(null);
    try {
      const result = await api.createReport(brief.accountId, transcript.trim(), isLive ? report?.id : undefined);
      setPreviousReport(report);
      setReport(result.report);
      setReportSources(result.sources);
      setTicket(structuredClone(result.report.ticketDraft));
      setPreviewIssue(false);
      setChatTurns([]);
      setClaimResult(null);
      const url = new URL(window.location.href);
      url.pathname = '/';
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
    if (!ticket.title.trim() || !ticket.acceptanceCriteria.some((item) => item.trim())) {
      setIssueError(new ApiError('Add a title and at least one acceptance criterion.', 400));
      return;
    }
    setBusy('issue');
    setIssueError(null);
    if (isLive) setReport({ ...report, linearIssueStatus: 'pending' });
    try {
      const result = await api.createIssue(report.id, {
        ...ticket,
        acceptanceCriteria: ticket.acceptanceCriteria.map((item) => item.trim()).filter(Boolean),
      });
      if (isLive) {
        if (!result.issue.identifier || !result.issue.url) throw new ApiError('Linear did not return a working issue link. Please retry.', 502);
        setReport({ ...report, linearIssue: result.issue, linearIssueStatus: 'created' });
        try {
          const saved = await api.getReport(report.id);
          setReport({ ...saved.report, linearIssue: result.issue, linearIssueStatus: 'created' });
          setTicket(structuredClone(saved.report.ticketDraft));
          setReportSources(saved.sources);
        } catch { /* Creation succeeded; retain the returned working issue link. */ }
      } else {
        setPreviewIssue(true);
      }
    } catch (error) {
      setIssueError(asApiError(error));
      if (isLive) {
        // Re-read the accepted draft and pending outcome; failed reads keep the optimistic lock.
        try {
          const saved = await api.getReport(report.id);
          setReport(saved.report);
          setTicket(structuredClone(saved.report.ticketDraft));
          setReportSources(saved.sources);
        } catch { /* Retry can still reconcile the original request. */ }
      }
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
    try {
      const history = chatTurns.slice(-5).flatMap((turn) => [{ role: 'user' as const, content: turn.question }, { role: 'assistant' as const, content: turn.answer.answer }]);
      const answer = await api.chat(brief.accountId, value, report?.id, history);
      setChatTurns((current) => [...current, { question: value, answer }].slice(-20));
      setQuestion('');
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
      setClaimResult(await api.checkClaim(brief.accountId, statement.trim(), report?.id));
    } catch (error) {
      setClaimError(asApiError(error));
    } finally {
      setClaimBusy(false);
    }
  };

  return (
    <div className={magic.animate ? 'app-shell effects-on' : 'app-shell effects-off'}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="forest-frame" aria-hidden="true" />
      <FireflyField active={magic.animate} />
      <header className="site-header">
        <div className="header-inner container">
          <button type="button" className="brand" onClick={() => goTo('overview')} aria-label="Deeproot home"><BranchMark small /><span>Deeproot</span></button>
          <nav aria-label="Main navigation" className="main-nav">
            {([['overview', 'Brief'], ['inbox', 'Inbox'], ['meeting', 'Meeting'], ['report', 'Report'], ['explore', 'Ask & verify'], ['apps', 'Apps']] as const).map(([id, label]) => (
              <button key={id} type="button" className={view === id ? 'nav-link is-active' : 'nav-link'} aria-current={view === id ? 'page' : undefined} onClick={() => goTo(id)} disabled={id === 'report' && !report}>{label}{view === id && (magic.animate ? <motion.span layoutId="nav-marker" className="nav-marker" transition={{ type: 'spring', stiffness: 430, damping: 34 }} aria-hidden="true">✧</motion.span> : <span className="nav-marker" aria-hidden="true">✧</span>)}</button>
            ))}
          </nav>
          <div className="header-account">{brief?.accountName || 'Account workspace'}<span className="workspace-mode"><i aria-hidden="true" />{isLive ? 'Live API' : 'Mock preview'}</span></div>
          <button type="button" className="effects-toggle" onClick={magic.toggle} disabled={magic.reduced} aria-pressed={magic.enabled} aria-label={magic.reduced ? 'Enchanted effects reduced by device setting' : magic.enabled ? 'Pause enchanted effects' : 'Resume enchanted effects'} title={magic.reduced ? 'Enchanted effects reduced by device setting' : magic.enabled ? 'Pause enchanted effects' : 'Resume enchanted effects'}><span aria-hidden="true">✧</span><span>{magic.reduced ? 'Motion reduced' : magic.enabled ? 'Magic on' : 'Magic off'}</span></button>
        </div>
      </header>

      {loadState === 'loading' ? <main id="main-content" className="loading-page" aria-live="polite"><h1>Loading account workspace</h1></main> :
      loadState === 'error' ? <main id="main-content" className="loading-page"><h1>Account workspace unavailable</h1><ErrorNotice error={pageError} /><button className="button button--primary" type="button" onClick={() => window.location.reload()}>Try again</button></main> :
      <motion.main key={view} id="main-content" className={view === 'inbox' ? 'container page-content page-content--inbox' : 'container page-content'} initial={magic.animate ? { opacity: 0, y: 14 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: magic.animate ? 0.34 : 0, ease: [0.22, 1, 0.36, 1] }}>
        {view === 'overview' && brief && <>
          <div className="page-lead page-lead--brief">
            <span className="fox-perch fox-perch--hero" data-fox-perch aria-hidden="true" />
            <SectionHeading kicker="Account brief" title={brief.accountName} />
            <div className="lead-actions"><button type="button" className="button button--primary" onClick={() => goTo('meeting')}>Process meeting <span aria-hidden="true">→</span></button><button type="button" className="text-button" disabled={briefBusy} onClick={() => void refreshBrief()}>{briefBusy ? 'Refreshing brief…' : 'Refresh brief'}</button></div>
          </div>
          <WorkflowStrip sourceCount={brief.sources.length} transcriptReady={!!transcript.trim()} reportReady={!!report} issueCreated={!!report?.linearIssue} onSources={() => document.getElementById('source-heading')?.scrollIntoView({ behavior: 'auto' })} onMeeting={() => goTo('meeting')} onReport={() => goTo('report')} />
          <div className="workspace-insights"><span><strong>{brief.items.filter((item) => item.type === 'risk' || item.type === 'blocker').length}</strong> risks & blockers</span><span><strong>{brief.openQuestions.length}</strong> open questions</span><span><strong>{new Set(brief.items.flatMap((item) => item.citations.map((citation) => citation.sourceId))).size}</strong> cited sources</span><span className="workspace-insights-note">{isLive ? 'Answers grounded in your account records' : 'Example records · Prepared responses'}</span></div>
          <ErrorNotice error={briefError} />
          {briefRefreshed && <p className="refresh-status" role="status">{isLive ? 'Brief refreshed from the current account sources.' : 'Mock brief reloaded. Connect the API for fresh analysis.'}</p>}
          <div className="overview-grid" data-reveal>
            <article className="surface brief-card">
              <div className="card-heading"><span className="section-index">01 / Summary</span><h2>Account summary</h2></div>
              <p className="brief-summary">{brief.brief}</p>
              <div className="brief-findings">{brief.items.map((item, index) => <div className="brief-finding" key={index}>{(item.type === 'risk' || item.type === 'blocker') && <span className={`finding-badge finding-badge--${item.type}`}>{item.type}{item.severity ? ` · ${item.severity}` : ''}</span>}<p>{item.text}</p><EvidenceButtons citations={item.citations} sources={sources} onSelect={setEvidence} /></div>)}</div>
            </article>
            <aside className="surface questions-card" aria-label="Questions for the meeting">
              <div className="card-heading"><span className="section-index">02 / Meeting prep</span><h2>Questions to resolve</h2></div>
              <ul className="question-list">{brief.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
            </aside>
          </div>
          <section className="source-section" aria-labelledby="source-heading" data-reveal>
            <span className="fox-perch fox-perch--section" data-fox-perch aria-hidden="true" />
            <div className="section-top"><div><span className="section-index">03 / Sources</span><h2 id="source-heading">Account sources</h2></div><div className="source-section-actions"><span className="source-count">{brief.sources.length} records</span><button type="button" className="text-button" onClick={() => goTo('inbox')}>Open inbox ↗</button></div></div>
            <div className="source-grid">{brief.sources.map((source) => <button className={changedIds.includes(source.id) ? "source-card source-card--changed" : "source-card"} key={source.id} type="button" onClick={() => setEvidence({ sourceId: source.id, sourceVersion: source.version })}>
              {changedIds.includes(source.id) && <span className="changed-badge">Updated by connector</span>}<span className="source-kind-label">{source.kind === 'internal_app' ? source.app?.name || 'Internal tool' : source.kind === 'meeting' ? 'Meeting transcript' : 'Email'}</span><span className="source-date">{authorName(source.author)} · {formatDate(source.occurredAt)}</span>
              <h3>{source.title}</h3>
              <p>{sourcePreview(source.body)}</p>
              <span className="text-link">Read source <span aria-hidden="true">→</span></span>
            </button>)}</div>
          </section>
        </>}

        {view === 'apps' && brief && <IntegrationsPanel accountId={brief.accountId} onSynced={async ids => { setChangedIds(ids); setBrief(await api.refreshBrief(brief.accountId)); setBriefRefreshed(true); }} />}

        {view === 'inbox' && brief && <InboxView accountName={brief.accountName} sources={brief.sources} transcript={transcript} report={report} onMeeting={() => goTo('meeting')} onReport={() => goTo('report')} mock={!isLive} />}

        {view === 'meeting' && brief && <>
          <div className="page-lead"><span className="fox-perch fox-perch--hero" data-fox-perch aria-hidden="true" /><SectionHeading kicker={brief.accountName} title="Process meeting" /></div>
          <div className="meeting-layout" data-reveal>
            <article className="surface upload-card"><span className="fox-perch fox-perch--card" data-fox-perch aria-hidden="true" />
              <div className="card-heading"><span className="section-index">Step 1</span><h2>Add a recording</h2></div>
              <div className={dragActive ? 'upload-zone is-dragging' : 'upload-zone'} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setDragActive(false); const file = event.dataTransfer.files[0]; if (file && /\.txt$/i.test(file.name)) void importTranscript(file); else void uploadFile(file); }}>
                <div className="recording-emblem" aria-hidden="true"><i /><i /><i /><i /><i /></div><p>Drop an MP4 recording or .txt transcript here. Your meeting becomes the evidence.</p>
                <input ref={fileInput} className="sr-only" type="file" accept=".mp4,video/mp4,audio/mp4" aria-label="MP4 recording" onChange={(event) => void uploadFile(event.target.files?.[0])} />
                <button type="button" className="button button--secondary" onClick={() => fileInput.current?.click()} disabled={busy !== null}>{busy === 'transcribe' ? <><WorkingGlyph /> Preparing and transcribing…</> : 'Choose MP4 file'}</button>
                <input ref={transcriptInput} className="sr-only" type="file" accept=".txt,text/plain" aria-label="Text transcript file" onChange={(event) => void importTranscript(event.target.files?.[0])} />
                <button type="button" className="text-button" onClick={() => transcriptInput.current?.click()} disabled={busy !== null}>Import text transcript</button>
                {uploadedName && <span className="upload-filename">Selected: {uploadedName}</span>}
              </div>
              {transcriptionOrigin && <p className="transcription-origin" role="status">{transcriptionOrigin === 'azure-speech' ? 'Transcription complete. Review it below.' : 'Prepared transcript loaded. Review it below.'}</p>}
              <div className="fallback-row"><span>For the demo:</span><button type="button" disabled={busy !== null} onClick={() => { setTranscript(DEMO_TRANSCRIPT); setTranscriptionOrigin('prepared-fallback'); setMeetingError(null); setUploadedName('Prepared transcript'); }}>Use prepared transcript</button></div>
              <p className="context-note">{isLive ? 'MP4 recordings of any length. Audio is extracted in your browser and sent in 5-minute parts; video never leaves your device. If Speech is unavailable, retry or import a transcript.' : 'Mock mode uses a prepared transcript for MP4 uploads and a sample report. Use live mode to analyze your own meeting.'}</p>
              <ErrorNotice error={meetingError} />
            </article>
            <article className="surface transcript-card"><span className="fox-perch fox-perch--card" data-fox-perch aria-hidden="true" />
              <div className="card-heading"><span className="section-index">Step 2</span><h2>Review transcript</h2></div>
              <label className="field" htmlFor="transcript"><span>Meeting transcript</span></label>
              <textarea id="transcript" maxLength={20_000} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="The transcript will appear here. You can also paste or edit text." rows={9} />
              <div className="transcript-actions"><span>{transcript.trim() ? `${transcript.trim().split(/\s+/).length} words` : 'No transcript yet'}</span><button type="button" className="button button--primary" onClick={() => void generateReport()} disabled={!transcript.trim() || busy !== null}>{busy === 'report' ? <><WorkingGlyph /> Generating report…</> : 'Generate report'} <span aria-hidden="true">→</span></button></div>
              <ErrorNotice error={reportError} />
            </article>
          </div>
        </>}

        {view === 'report' && report && ticket && <>
          <div className="page-lead"><span className="fox-perch fox-perch--hero" data-fox-perch aria-hidden="true" /><SectionHeading kicker={`${brief?.accountName || 'Account'} / ${formatDate(report.createdAt)}`} title="Meeting report" /></div>
          {previousReport && <ReportComparison previous={previousReport} current={report} />}
          <div className="report-layout" data-reveal>
            <div className="report-main">
              <article className="surface report-summary"><span className="fox-perch fox-perch--card" data-fox-perch aria-hidden="true" /><div className="card-heading"><span className="section-index">Summary</span><h2>What happened</h2></div><p className="brief-summary">{report.summary}</p><EvidenceButtons citations={report.summaryCitations ?? []} sources={sources} onSelect={setEvidence} /></article>
              <div className="report-columns">
                <article className="surface"><div className="card-heading"><span className="section-index">01</span><h2>Decisions</h2></div>{report.decisions.length ? report.decisions.map((item, index) => <div className="report-item" key={index}><p>{item.text}</p><EvidenceButtons citations={item.citations} sources={sources} onSelect={setEvidence} /></div>) : <p className="muted">No decisions identified.</p>}</article>
                <article className="surface"><div className="card-heading"><span className="section-index">02</span><h2>Open questions</h2></div>{report.openQuestions.length ? <ul className="question-list">{report.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">No open questions identified.</p>}</article>
              </div>
              <article className="surface commitment-card"><div className="card-heading"><span className="section-index">03</span><h2>Commitments</h2></div>{report.commitments.length ? report.commitments.map((item, index) => <div key={index} className="commitment-item"><p>{item.text}</p><div className="fact-row"><div><span className="mini-label">Owner</span><strong>{item.owner || 'Unknown'}</strong></div><div><span className="mini-label">Due date</span><strong>{item.dueDate ? formatDate(item.dueDate) : 'Unknown'}</strong></div></div><EvidenceButtons citations={item.citations} sources={sources} onSelect={setEvidence} /></div>) : <p className="muted">No commitments identified.</p>}</article>
              {report.risks.length > 0 && <article className="surface risk-card"><div className="card-heading"><span className="section-index">04</span><h2>Delivery risks</h2></div>{report.risks.map((risk, index) => <div className="risk-item" key={index}><p>{risk.text}</p><EvidenceButtons citations={risk.citations} sources={sources} onSelect={setEvidence} /></div>)}</article>}
              <article className="follow-up-card"><h2>Suggested follow-up</h2><p>{report.suggestedFollowUp || "No supported follow-up wording was established."}</p>{report.suggestedFollowUp && <><EvidenceButtons citations={report.followUpCitations ?? []} sources={sources} onSelect={setEvidence} /><CopyButton text={report.suggestedFollowUp} label="Copy follow-up" /></>}</article>
            </div>
            <aside className="surface ticket-card"><span className="fox-perch fox-perch--card" data-fox-perch aria-hidden="true" /><div className="card-heading"><span className="section-index">Next action</span><h2>Linear issue draft</h2></div><p className="ticket-hint">{report.ticketStatus === 'none' ? 'No actionable task was established by the reviewed evidence.' : report.linearIssueStatus === 'pending' ? 'The reviewed draft is saved. Reconcile this attempt before making further edits.' : 'Edit the draft before creating the issue.'}</p>
              {report.ticketStatus !== 'none' && <><label className="field"><span>Issue title</span><input value={ticket.title} onChange={(event) => editTicket({ ...ticket, title: event.target.value })} disabled={ticketLocked} /></label>
              <label className="field"><span>Description</span><textarea rows={5} value={ticket.description} onChange={(event) => editTicket({ ...ticket, description: event.target.value })} disabled={ticketLocked} /></label>
              <div className="field"><span>Acceptance criteria</span>{ticket.acceptanceCriteria.map((criterion, index) => <div className="criterion-row" key={index}><textarea rows={2} aria-label={`Acceptance criterion ${index + 1}`} value={criterion} onChange={(event) => editTicket({ ...ticket, acceptanceCriteria: ticket.acceptanceCriteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} disabled={ticketLocked} /><button type="button" aria-label={`Remove criterion ${index + 1}`} onClick={() => editTicket({ ...ticket, acceptanceCriteria: ticket.acceptanceCriteria.filter((_, itemIndex) => itemIndex !== index) })} disabled={ticketLocked}>×</button></div>)}<button className="text-button" type="button" onClick={() => editTicket({ ...ticket, acceptanceCriteria: [...ticket.acceptanceCriteria, ''] })} disabled={ticketLocked}>+ Add criterion</button></div>
              <label className="field"><span>Priority</span><select value={ticket.priority} onChange={(event) => editTicket({ ...ticket, priority: event.target.value as TicketDraft['priority'] })} disabled={ticketLocked}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              </>}
              <ErrorNotice error={issueError} />
              {report.linearIssue ? <div className="issue-success" role="status"><strong>Created in Linear</strong><a href={report.linearIssue.url} target="_blank" rel="noreferrer">Open {report.linearIssue.identifier} ↗</a></div> : previewIssue ? <div className="issue-success" role="status"><strong>Demo preview ready</strong><span>No issue was created. Connect the API to create one in Linear.</span></div> : <button type="button" className="button button--primary ticket-submit" onClick={() => void createIssue()} disabled={busy !== null || report.ticketStatus === "none"}>{busy === 'issue' ? <><WorkingGlyph /> Creating issue…</> : issueAction}</button>}
            </aside>
          </div>
          <div className="inline-next"><button className="text-button" type="button" onClick={() => goTo('explore')}>Ask and verify <span aria-hidden="true">→</span></button></div>
        </>}

        {view === 'explore' && brief && <>
          <div className="page-lead"><span className="fox-perch fox-perch--hero" data-fox-perch aria-hidden="true" /><SectionHeading kicker={brief.accountName} title="Ask and verify" /></div>
          <div className="explore-grid" data-reveal>
            <article className="surface tool-card ask-card"><div className="card-heading"><span className="section-index">Account question</span><h2>Ask about the account</h2></div><AskPanel question={question} onQuestion={setQuestion} onAsk={(value) => void askQuestion(value)} onReset={() => { setChatTurns([]); setQuestion(''); setChatError(null); }} turns={chatTurns} busy={chatBusy} sources={sources} onEvidence={setEvidence} accountName={brief.accountName} /><ErrorNotice error={chatError} /></article>
            <article className="surface tool-card"><div className="card-heading"><span className="section-index">Claim check</span><h2>Check a statement</h2></div><p className="verification-intro">Stress-test a client promise before you send it. Every verdict points back to its evidence.</p><form onSubmit={(event) => { event.preventDefault(); void checkClaim(); }}><label className="field" htmlFor="statement"><span>Draft statement</span></label><textarea id="statement" maxLength={1000} rows={3} value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="Write a statement to verify…" /><button type="submit" className="button button--secondary" disabled={!statement.trim() || claimBusy}>{claimBusy ? <><WorkingGlyph /> Checking sources…</> : 'Check statement'}</button></form><ErrorNotice error={claimError} />{claimResult && <div className="tool-result" aria-live="polite"><span className={`verdict verdict--${claimResult.verdict}`}>{claimResult.refusalReason ? 'Outside this role' : claimResult.verdict[0].toUpperCase() + claimResult.verdict.slice(1)}</span><p>{claimResult.explanation}</p><InvestigationSteps steps={claimResult.steps} />{claimResult.claimResults?.map((claim, i) => <div className={`claim-card claim-card--${claim.verdict}`} key={i}><span className={`verdict verdict--${claim.verdict}`}>{claim.verdict}</span><p>{claim.claim}</p><small>{claim.explanation}</small><EvidenceButtons citations={claim.citations} sources={sources} onSelect={setEvidence} /></div>)}<EvidenceButtons citations={claimResult.citations} sources={sources} onSelect={setEvidence} />{claimResult.suggestedRewrite && <div className="rewrite"><h3>Suggested wording</h3><p>{claimResult.suggestedRewrite}</p><CopyButton text={claimResult.suggestedRewrite} label="Copy verified wording" /></div>}</div>}</article>
          </div>
        </>}
      </motion.main>}
      <footer className="site-footer"><div className="container footer-inner"><span>Deeproot</span><span>GirlHacks 2026</span></div></footer>
      <EvidencePanel selection={evidence} sources={sources} onClose={closeEvidence} animate={magic.animate} accountId={brief?.accountId} reportId={report?.id} />
      <FoxCompanion motionEnabled={magic.animate} sceneKey={`${view}-${loadState}`} />
      <ButterflyCursor active={magic.animate} />
      <ForestOpening active={magic.animate} />
    </div>
  );
}

export default App;
