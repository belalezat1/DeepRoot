import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import type { Citation, PublicSource } from './model';
import { api, isLive } from "./api";
import { formatDate } from './format';

export type EvidenceSelection = { sourceId: string; sourceVersion?: string; quote?: string };

export function EvidenceButtons({ citations, sources, onSelect }: { citations: Citation[]; sources: PublicSource[]; onSelect: (value: EvidenceSelection) => void }) {
  if (!citations.length) return null;
  return (
    <div className="evidence-links" aria-label="Supporting evidence">
      {citations.map((citation, index) => (
        <button key={`${citation.sourceId}-${index}`} type="button" className="evidence-link" onClick={() => onSelect(citation)}>
          View: {(() => { const source = sources.find((item) => item.id === citation.sourceId && (!citation.sourceVersion || item.version === citation.sourceVersion)); return source?.kind === 'internal_app' ? `${source.app?.name || 'Internal app'}: ${source.title}` : source?.title || 'Source'; })()} <span aria-hidden="true">↗</span>
        </button>
      ))}
    </div>
  );
}

function EvidenceDialog({ selection, sources, onClose, animate, accountId, reportId }: { selection: EvidenceSelection; sources: PublicSource[]; onClose: () => void; animate: boolean; accountId?: string; reportId?: string }) {
  const cached = sources.find((item) => item.id === selection?.sourceId && (!selection.sourceVersion || item.version === selection.sourceVersion));
  const [resolved, setResolved] = useState<PublicSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResolved(null);
    if (cached && !isLive) { setResolved(cached); return; }
    if (!accountId) return;
    setLoading(true); setFailed(false);
    api.getSource(accountId, selection.sourceId, selection.sourceVersion, reportId).then(s => { if (active) setResolved(s); }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, selection.sourceId, selection.sourceVersion, reportId, cached, attempt]);
  const source = isLive ? resolved : resolved ?? cached;
  const quote = selection?.quote;
  const index = source && quote ? source.body.indexOf(quote) : -1;
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = useState(0);
  const present = useIsPresent();

  useEffect(() => {
    if (!selection) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocus.current = previousFocus;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') { const panel = closeButton.current?.closest('aside'); const focusable = Array.from(panel?.querySelectorAll<HTMLElement>('button, a[href]') ?? []).filter(el => !el.hasAttribute('disabled')); const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [selection, onClose]);

  useEffect(() => { if (!present) returnFocus.current?.focus(); }, [present]);

  return (
    <motion.div className="panel-scrim" onMouseDown={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: animate ? 0.23 : 0 }}>
      <motion.aside className="evidence-panel" role={present ? 'dialog' : undefined} aria-modal={present ? 'true' : undefined} aria-label="Source evidence" aria-hidden={!present} onMouseDown={(event) => event.stopPropagation()} initial={{ x: animate ? '100%' : 0 }} animate={{ x: dragX }} exit={{ x: animate ? '100%' : 0 }} transition={{ duration: animate ? 0.29 : 0, ease: [0.22, 1, 0.36, 1] }}>
        <div className="panel-topline"><div className="panel-topline-left"><span className="eyebrow">Source evidence</span><div className="panel-swipe-handle" aria-hidden="true" onPointerDown={(event) => { swipeStart.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerMove={(event) => { if (swipeStart.current) setDragX(Math.max(0, event.clientX - swipeStart.current.x)); }} onPointerUp={(event) => { const start = swipeStart.current; swipeStart.current = null; if (start && event.clientX - start.x > 72 && Math.abs(event.clientY - start.y) < (event.clientX - start.x) * 0.8) onClose(); else setDragX(0); }} onPointerCancel={() => { swipeStart.current = null; setDragX(0); }} /></div><button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close evidence">×</button></div>
        {source ? (
          <>
            <span className="source-kind">{source.kind === 'email' ? 'Email' : source.kind === 'internal_app' ? source.app?.name || 'Internal app' : 'Transcript'}</span>
            <h2>{source.title}</h2>
            <div className="panel-meta"><span>{source.author}</span><span>{formatDate(source.occurredAt)}</span></div>
            <div className="panel-rule" />
            <p className="panel-caption">Original source excerpt</p>
            <blockquote className="source-body">
              {index >= 0 && quote ? <>{source.body.slice(0, index)}<mark>{quote}</mark>{source.body.slice(index + quote.length)}</> : source.body}
            </blockquote>
            {quote && index < 0 && <p className="notice notice--soft">The cited quote could not be located in this source text.</p>}
          </>
        ) : <div className="empty-state"><h2>{loading ? "Loading source…" : "Source unavailable"}</h2><p>{failed ? "This record is unavailable or your access has changed. Historical evidence is never replaced with an unrelated current record." : "This source is not included in the current account view."}</p>{failed && <button type="button" className="button button--secondary" onClick={() => setAttempt(a => a + 1)}>Retry source lookup</button>}</div>}
      </motion.aside>
    </motion.div>
  );
}

export function EvidencePanel({ selection, sources, onClose, animate, accountId, reportId }: { selection: EvidenceSelection | null; sources: PublicSource[]; onClose: () => void; animate: boolean; accountId?: string; reportId?: string }) {
  return <AnimatePresence>{selection && <EvidenceDialog key={selection.sourceId + (selection.sourceVersion || "") + (selection.quote || '')} selection={selection} sources={sources} onClose={onClose} animate={animate} accountId={accountId} reportId={reportId} />}</AnimatePresence>;
}

