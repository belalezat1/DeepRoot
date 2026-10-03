import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, arc, motion } from 'motion/react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const FINE_POINTER = '(pointer: fine)';
const EFFECTS_KEY = 'deeproot-effects';
const INTRO_KEY = 'deeproot-opening-seen';
const FOX_ARC_RIGHT = arc({ strength: 0.34, peak: 0.5, direction: 'cw' });
const FOX_ARC_LEFT = arc({ strength: 0.34, peak: 0.5, direction: 'ccw' });

function readStorage(storage: Storage, key: string) {
  try { return storage.getItem(key); } catch { return null; }
}

export function useEnchantedMotion() {
  const [enabled, setEnabled] = useState(() => readStorage(localStorage, EFFECTS_KEY) !== 'off');
  const [reduced, setReduced] = useState(() => window.matchMedia?.(REDUCED_MOTION).matches ?? false);

  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION);
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const toggle = () => {
    setEnabled((current) => {
      const next = !current;
      try { localStorage.setItem(EFFECTS_KEY, next ? 'on' : 'off'); } catch { /* Storage may be disabled. */ }
      return next;
    });
  };

  return { enabled, reduced, animate: enabled && !reduced, toggle };
}

export function useSectionReveals(view: string, animate: boolean) {
  useEffect(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
    if (!animate || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [view, animate]);
}

function SpiritFoxDrawing({ idPrefix }: { idPrefix: string }) {
  return (
    <svg viewBox="0 0 188 136" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${idPrefix}-body`} x1="84" y1="49" x2="135" y2="111" gradientUnits="userSpaceOnUse"><stop stopColor="#ffc779"/><stop offset=".45" stopColor="#ec873e"/><stop offset="1" stopColor="#ad4f32"/></linearGradient>
        <linearGradient id={`${idPrefix}-tail`} x1="20" y1="38" x2="105" y2="101" gradientUnits="userSpaceOnUse"><stop stopColor="#fff4cf"/><stop offset=".34" stopColor="#f6b762"/><stop offset="1" stopColor="#ca6038"/></linearGradient>
        <linearGradient id={`${idPrefix}-face`} x1="128" y1="35" x2="173" y2="83" gradientUnits="userSpaceOnUse"><stop stopColor="#ffcf83"/><stop offset="1" stopColor="#dc6c3c"/></linearGradient>
        <radialGradient id={`${idPrefix}-aura`}><stop stopColor="#ffd38a" stopOpacity=".25"/><stop offset="1" stopColor="#ffd38a" stopOpacity="0"/></radialGradient>
      </defs>
      <ellipse cx="96" cy="73" rx="86" ry="58" fill={`url(#${idPrefix}-aura)`} />
      <g className="spirit-tail">
        <path d="M98 88C74 110 39 101 20 78 10 66 7 47 12 28c13 21 31 30 48 29-8-10-11-19-8-29 17 22 44 19 58 43 7 12 3 22-12 17Z" fill={`url(#${idPrefix}-tail)`} stroke="#ffe8bd" strokeOpacity=".78" strokeWidth="1.5" />
        <path d="M12 28c-5 19-2 38 8 50 7 8 17 14 28 18-9-13-10-28-5-39-12-5-23-14-31-29Z" fill="#fff5dc" opacity=".93" />
        <path d="M28 72c24 25 52 29 75 10M52 29c13 30 27 30 43 47" stroke="#fff0cf" strokeOpacity=".65" strokeWidth="2" strokeLinecap="round" />
      </g>
      <path d="M85 85c0-17 15-30 38-31 20-1 32 9 32 25 0 17-14 30-38 31-20 1-32-8-32-25Z" fill={`url(#${idPrefix}-body)`} stroke="#ffdda6" strokeOpacity=".75" strokeWidth="1.5" />
      <path d="M92 94c13 13 34 14 55-2-6 13-17 19-31 19-11 0-20-5-24-17Z" fill="#fff0d0" opacity=".9" />
      <path d="M96 100c-6 8-7 19-8 28h10l8-24m21 0c-1 10 1 17 4 24h10l-2-25m7-18c11 8 17 19 20 30h9c-2-19-10-30-22-39" fill="#b85c39" stroke="#efaa66" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M87 128h15m25 0h17m20-13h13" stroke="#4c3540" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M126 57c5-12 17-17 31-14 12 3 20 11 24 22l5 3-5 6-23 12c-13 6-27 1-33-10-4-7-4-13 1-19Z" fill={`url(#${idPrefix}-face)`} stroke="#ffe0af" strokeWidth="1.5" />
      <path d="m133 50-3-30 20 23 18-25 5 40" fill="#e98243" stroke="#ffd6a2" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m136 30 3 18 8-5m14 1 7-17 1 26" fill="#b45747" opacity=".72" />
      <path d="M143 71c11 4 25 2 37-3l-5 9-18 10c-14 6-26 0-31-10 5-1 11-3 17-6Z" fill="#fff2d9" />
      <path d="M142 60c3-3 8-3 11-1" stroke="#3e333c" strokeWidth="2.7" strokeLinecap="round" />
      <circle cx="148" cy="59" r="1.5" fill="#fff5d8" />
      <path d="m181 66 6 3-5 5-6-3 5-5Z" fill="#3e333c" />
      <path d="M92 70c9 8 20 12 31 10" stroke="#ffd9a2" strokeWidth="2" strokeOpacity=".7" strokeLinecap="round" />
      <path d="m66 32 3-7 3 7 7 3-7 3-3 7-3-7-7-3 7-3Zm38-21 2-5 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#ffe5a0" opacity=".95" />
      <circle cx="27" cy="106" r="1.8" fill="#ffe4a7"/><circle cx="72" cy="116" r="1.6" fill="#d8c7ff"/><circle cx="174" cy="41" r="1.8" fill="#f7dfa8"/>
    </svg>
  );
}

export function FoxCompanion({ motionEnabled, sceneKey }: { motionEnabled: boolean; sceneKey: string }) {
  const [place, setPlace] = useState({ x: 0, y: 0, ready: false, travel: false, duration: 0 });
  const [reaction, setReaction] = useState(0);
  const [facing, setFacing] = useState(1);
  const currentPerch = useRef<Element | null>(null);
  const lastPoint = useRef({ x: 0, y: 0, ready: false });
  const lastScene = useRef(sceneKey);

  useEffect(() => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    let frame = 0;
    const sceneChanged = lastScene.current !== sceneKey;
    lastScene.current = sceneKey;
    const anchors = () => [...document.querySelectorAll<HTMLElement>('[data-fox-perch]')];
    const visible = () => anchors().filter((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return rect.top > 65 && rect.top < window.innerHeight - 24 && rect.right > 30 && rect.left < window.innerWidth - 30;
    });
    const positionAt = (anchor: HTMLElement, leap = false) => {
      const rect = anchor.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const foxWidth = window.innerWidth <= 460 ? 72 : window.innerWidth <= 720 ? 86 : 128;
      const x = Math.max(6, rect.left - shellRect.left - foxWidth * .55);
      const y = Math.max(78, rect.top - shellRect.top - foxWidth * .74);
      const previous = lastPoint.current;
      if (previous.ready && previous.x === x && previous.y === y) return;
      const distance = Math.hypot(x - previous.x, y - previous.y);
      const travel = motionEnabled && leap && previous.ready && distance > 24 && distance < window.innerHeight * 1.1;
      if (previous.ready && Math.abs(x - previous.x) > 8) setFacing(x >= previous.x ? 1 : -1);
      lastPoint.current = { x, y, ready: true };
      setPlace({ x, y, ready: true, travel, duration: travel ? Math.min(.84, Math.max(.48, distance / 1050)) : 0 });
      if (travel) setReaction((count) => count + 1);
      currentPerch.current = anchor;
    };
    const findCurrent = () => {
      const available = visible();
      if (available.includes(currentPerch.current as HTMLElement)) return;
      const nearest = available.sort((a, b) => Math.abs(a.getBoundingClientRect().top - window.innerHeight * .43) - Math.abs(b.getBoundingClientRect().top - window.innerHeight * .43))[0];
      if (nearest) positionAt(nearest, true);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; findCurrent(); }); };
    const onResize = () => { const anchor = currentPerch.current as HTMLElement | null; if (anchor && document.contains(anchor)) positionAt(anchor); else findCurrent(); };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.app-shell button:not(:disabled), .app-shell a')) return;
      if (!motionEnabled) return;
      if (target.closest('.nav-link, .brand')) { setReaction((count) => count + 1); return; }
      if (!target.closest('.button, .source-card, .inbox-row-open, .inbox-context-list button')) { setReaction((count) => count + 1); return; }
      const available = visible();
      if (available.length > 1) {
        const index = available.indexOf(currentPerch.current as HTMLElement);
        positionAt(available[(index + 1) % available.length], true);
      } else setReaction((count) => count + 1);
    };
    const first = visible()[0] || anchors()[0];
    if (first) positionAt(first, sceneChanged);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('click', onClick);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    anchors().forEach((anchor) => observer?.observe(anchor));
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); document.removeEventListener('click', onClick); };
  }, [sceneKey, motionEnabled]);

  const activeReaction = motionEnabled && reaction > 0;
  return <motion.div className={motionEnabled ? 'fox-companion is-animated' : 'fox-companion'} aria-hidden="true" initial={false} animate={{ x: place.x, y: place.y, opacity: place.ready ? 1 : 0 }} transition={{ duration: place.travel ? place.duration : 0, ease: [0.22, 1, 0.36, 1], path: place.travel ? (facing === 1 ? FOX_ARC_RIGHT : FOX_ARC_LEFT) : undefined }}>
    <motion.div key={reaction} className="spirit-fox-motion" initial={false} animate={activeReaction ? { y: [0, 7, place.travel ? -25 : -13, 0], rotate: [0, -4, 4, 0], scaleX: facing, scaleY: [1, .86, 1.08, 1] } : { y: 0, rotate: 0, scaleX: facing, scaleY: 1 }} transition={{ duration: activeReaction ? (place.travel ? place.duration : .42) : 0, times: [0, .17, .68, 1], ease: [0.22, 1, 0.36, 1] }}><SpiritFoxDrawing idPrefix="companion-fox" /></motion.div>
    <motion.span key={`shadow-${reaction}`} className="fox-shadow" initial={false} animate={activeReaction ? { scaleX: [1, .82, .52, 1], opacity: [.38, .28, .12, .38] } : { scaleX: 1, opacity: .38 }} transition={{ duration: activeReaction ? (place.travel ? place.duration : .42) : 0, times: [0, .17, .68, 1] }} />
    {activeReaction && <span key={`spark-${reaction}`} className="fox-landing-sparks" style={{ '--fox-spark-delay': `${Math.max(0, (place.travel ? place.duration : .42) - .18)}s` } as CSSProperties}>{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span>}
  </motion.div>;
}

export function ForestOpening({ active }: { active: boolean }) {
  const [show, setShow] = useState(() => active && readStorage(sessionStorage, INTRO_KEY) !== 'yes');
  const skip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem(INTRO_KEY, 'yes'); } catch { /* Storage may be disabled. */ }
    const timer = window.setTimeout(() => setShow(false), 2100);
    skip.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShow(false);
      if (event.key === 'Tab') { event.preventDefault(); skip.current?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKeyDown); };
  }, [show]);

  useEffect(() => { if (!active) setShow(false); }, [active]);

  return <AnimatePresence>{show && <motion.div className="forest-opening" role="dialog" aria-modal="true" aria-label="Welcome to Deeproot" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
    <div className="opening-stars" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} />)}</div>
    <div className="opening-branch opening-branch--left" aria-hidden="true" />
    <div className="opening-branch opening-branch--right" aria-hidden="true" />
    <div className="opening-center"><div className="opening-emblem"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="42" /><path d="M60 95V45m0 29C40 75 32 61 27 48m33 14c18 0 27-14 31-24M60 54c-17-8-18-21-19-29m19 20c7-18 14-21 23-22" /></svg></div><span>GirlHacks 2026</span><strong>Deeproot</strong></div>
    <div className="opening-fox" aria-hidden="true"><SpiritFoxDrawing idPrefix="opening-fox" /></div>
    <button ref={skip} className="opening-skip" type="button" onClick={() => setShow(false)}>Skip intro <span aria-hidden="true">↗</span></button>
  </motion.div>}</AnimatePresence>;
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hue: number };

export function ButterflyCursor({ active }: { active: boolean }) {
  const butterfly = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const finePointer = window.matchMedia?.(FINE_POINTER).matches ?? false;
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    if (finePointer) document.body.classList.add('has-butterfly-cursor');
    let particles: Particle[] = [];
    let frame = 0;
    let lastDust = 0;
    let x = -100;
    let y = -100;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(window.innerWidth * dpr);
      element.height = Math.round(window.innerHeight * dpr);
      element.style.width = `${window.innerWidth}px`;
      element.style.height = `${window.innerHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const add = (px: number, py: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = count > 1 ? 1.2 + Math.random() * 2.3 : 0.35 + Math.random() * 0.8;
        particles.push({ x: px, y: py, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 0.55, life: 0, max: 22 + Math.random() * 22, size: 1.3 + Math.random() * 2, hue: Math.random() > 0.45 ? 52 : 93 });
      }
      if (particles.length > 100) particles = particles.slice(-100);
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const draw = () => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles = particles.filter((particle) => particle.life < particle.max);
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.01;
        particle.life++;
        context.fillStyle = `hsla(${particle.hue}, 96%, 78%, ${1 - particle.life / particle.max})`;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size * (1 - particle.life / particle.max / 2), 0, Math.PI * 2);
        context.fill();
      }
      frame = particles.length ? requestAnimationFrame(draw) : 0;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) {
        if (butterfly.current) butterfly.current.style.opacity = '0';
        return;
      }
      x = event.clientX; y = event.clientY;
      if (butterfly.current) { butterfly.current.style.transform = `translate3d(${x}px, ${y}px, 0)`; butterfly.current.style.opacity = '1'; }
      if (performance.now() - lastDust > 18) { add(x, y + 9, 1); lastDust = performance.now(); }
    };
    const click = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest('button:not(:disabled), a');
      if (target) {
        const rect = target.getBoundingClientRect();
        add(event.detail === 0 ? rect.left + rect.width / 2 : event.clientX, event.detail === 0 ? rect.top + rect.height / 2 : event.clientY, 12);
      }
    };
    resize();
    window.addEventListener('resize', resize);
    if (finePointer) window.addEventListener('pointermove', move);
    document.addEventListener('click', click);
    return () => {
      document.body.classList.remove('has-butterfly-cursor');
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
      document.removeEventListener('click', click);
      cancelAnimationFrame(frame);
    };
  }, [active]);

  if (!active) return null;
  return <><canvas ref={canvas} className="pixie-canvas" aria-hidden="true" /><div ref={butterfly} className="butterfly-cursor" aria-hidden="true"><svg viewBox="0 0 46 42" fill="none"><path d="M22 21C7 4-2 12 4 24c4 7 11 7 18-3Z" fill="#c9c2f4" stroke="#f7dc97" strokeWidth="1.5" /><path d="M24 21C39 4 48 12 42 24c-4 7-11 7-18-3Z" fill="#c9c2f4" stroke="#f7dc97" strokeWidth="1.5" /><path d="M21 23C8 20 8 36 17 37c4 0 6-6 4-14Zm4 0c13-3 13 13 4 14-4 0-6-6-4-14Z" fill="#9fe3b5" stroke="#f7dc97" strokeWidth="1.5" /><path d="M23 13v23m0-22c-3-7-6-9-9-9m9 9c3-7 6-9 9-9" stroke="#392a46" strokeWidth="2" strokeLinecap="round" /></svg></div></>;
}

export function FireflyField({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="firefly-field" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--i': index, left: `${(index * 37 + 7) % 96}%`, top: `${(index * 29 + 9) % 92}%` } as CSSProperties} />)}</div>;
}
