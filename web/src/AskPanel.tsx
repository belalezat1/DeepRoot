import { InvestigationSteps } from "./InvestigationSteps";
import { useEffect, useRef } from 'react';
import { EvidenceButtons, type EvidenceSelection } from './EvidencePanel';
import type { ChatAnswer, PublicSource } from './model';

export type ChatTurn = { question: string; answer: ChatAnswer };

export function AskPanel({ question, onQuestion, onAsk, onReset, turns, busy, sources, onEvidence, accountName }: {
  question: string; onQuestion: (value: string) => void; onAsk: (value?: string) => void;
  onReset: () => void; turns: ChatTurn[]; busy: boolean; sources: PublicSource[];
  onEvidence: (value: EvidenceSelection) => void; accountName: string;
}) {
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [turns, busy]);
  return <>
    <div className="assistant-intro"><span className="assistant-avatar" aria-hidden="true">✦</span><div><strong>Your account copilot</strong><p>Delivery questions in. Evidence-backed answers out.</p></div><span className="scope-pill">Account team</span></div>
    <p className="assistant-scope">Ask follow-ups about {accountName}. Individual pay, personal tax and banking details are outside this role.</p>
    {turns.length > 0 && <button className="text-button reset-chat" type="button" onClick={onReset} disabled={busy}>New conversation</button>}
    <div ref={thread} className="chat-thread" role="log" aria-label="Account conversation" aria-live="polite" aria-relevant="additions">
      {turns.map((turn, index) => <div className="chat-turn" key={index}>
        <div className="chat-message chat-message--user"><span className="mini-label">You</span><p>{turn.question}</p></div>
        <div className={`chat-message chat-message--assistant ${turn.answer.grounded ? 'is-grounded' : 'is-boundary'}`}><span className="answer-status">{turn.answer.grounded ? '✧ Answer · evidence checked' : turn.answer.responseType === 'restricted' ? '◇ Restricted information' : turn.answer.responseType === 'out_of_scope' ? '◇ Role boundary' : '◇ Not in the records'}</span><p>{turn.answer.answer}</p><InvestigationSteps steps={turn.answer.steps} /><EvidenceButtons citations={turn.answer.citations} sources={sources} onSelect={onEvidence} /></div>
      </div>)}
      {busy && <div className="chat-pending" role="status"><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>Investigating the account evidence…</div>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); onAsk(); }}>
      <label className="field" htmlFor="question"><span>{turns.length ? 'Follow-up question' : 'Your question'}</span></label>
      <textarea id="question" rows={3} maxLength={500} value={question} onChange={(event) => onQuestion(event.target.value)} placeholder="Ask about blockers, owners or the latest meeting…" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); onAsk(); } }} />
      <div className="chat-compose-actions"><button type="submit" className="button button--primary" disabled={!question.trim() || busy}>{busy ? 'Investigating…' : 'Ask question'} <span aria-hidden="true">↗</span></button><span>{question.length}/500 · Ctrl/⌘ + Enter</span></div>
    </form>
    {!turns.length && <div className="suggestions"><span className="mini-label">Explore the evidence</span>{['What is blocking the launch?', 'Who owns state tax setup?', 'Create me a Python script', 'Show individual payroll details'].map((value) => <button type="button" key={value} disabled={busy} onClick={() => onAsk(value)}>{value}</button>)}</div>}
  </>;
}
