import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const FINE_POINTER = '(pointer: fine)';
const EFFECTS_KEY = 'deeproot-effects';
const INTRO_KEY = 'deeproot-opening-seen';

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
        <linearGradient id={`${idPrefix}-body`} x1="65" y1="34" x2="128" y2="121" gradientUnits="userSpaceOnUse"><stop stopColor="#f2f5d5"/><stop offset=".48" stopColor="#b7e7d5"/><stop offset="1" stopColor="#78a9bf"/></linearGradient>
        <linearGradient id={`${idPrefix}-tail`} x1="8" y1="24" x2="97" y2="108" gradientUnits="userSpaceOnUse"><stop stopColor="#d8c9ff" stopOpacity=".36"/><stop offset=".48" stopColor="#bde9df"/><stop offset="1" stopColor="#eff8cb"/></linearGradient>
        <linearGradient id={`${idPrefix}-face`} x1="126" y1="19" x2="157" y2="89" gradientUnits="userSpaceOnUse"><stop stopColor="#fff9dd"/><stop offset="1" stopColor="#a5d8d1"/></linearGradient>
        <radialGradient id={`${idPrefix}-aura`}><stop stopColor="#d9f5c9" stopOpacity=".32"/><stop offset="1" stopColor="#d9f5c9" stopOpacity="0"/></radialGradient>
      </defs>
      <ellipse cx="98" cy="75" rx="88" ry="60" fill={`url(#${idPrefix}-aura)`} />
      <g className="spirit-tail"><path d="M93 91C42 104 26 69 13 37c20 17 39 9 53 22C53 37 41 31 37 14c34 17 73 8 81 49 4 23-8 34-25 28Z" fill={`url(#${idPrefix}-tail)`} stroke="#d7eddd" strokeOpacity=".8" strokeWidth="1.5"/><path d="M16 36c23 21 50 15 68 47M37 15c21 26 43 28 60 54" stroke="#f5f7df" strokeOpacity=".65" strokeWidth="2" strokeLinecap="round"/><path d="M17 42c18 10 31 9 43 18" stroke="#d9c9ff" strokeOpacity=".75" strokeWidth="2" strokeLinecap="round"/></g>
      <path d="M78 79c10-19 28-30 52-27 17 3 24 17 20 31-5 20-28 30-48 26-16-3-31-15-24-30Z" fill={`url(#${idPrefix}-body)`} stroke="#e3f8dd" strokeOpacity=".66" strokeWidth="1.5" />
      <path d="M98 99c-9 10-10 20-14 30m34-26c-1 10 3 19 4 26m19-42c8 6 13 16 17 27" stroke="#c7eadb" strokeWidth="8" strokeLinecap="round" />
      <path d="M84 128h16m17 1h15m23-15h13" stroke="#e9f2d0" strokeWidth="4" strokeLinecap="round" />
      <path d="M116 57c5-11 17-17 34-13 11 3 22 14 27 27-11 3-20 6-29 17-13 9-28 3-33-9-3-8-3-15 1-22Z" fill={`url(#${idPrefix}-face)`} stroke="#f4f7df" strokeWidth="1.5" />
      <path d="m126 52 3-34 19 26 16-25 7 38" fill="#dceee2" stroke="#f3f8dd" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m132 28 1 19 10-4m17-1 6-13 1 25" fill="#aeabc9" fillOpacity=".68" />
      <path d="M144 72c10 6 23 5 32-1-6 11-14 19-27 19-11 0-17-9-18-17l13-1Z" fill="#f8f5df" fillOpacity=".82" />
      <path d="M139 61c4-3 8-3 11 0" stroke="#4e536f" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="145" cy="61" r="2.3" fill="#f3cb75" /><circle cx="146" cy="60" r=".75" fill="#fff" />
      <path d="m174 72 5 3-5 3-5-3 5-3Z" fill="#69768e" />
      <path d="M86 70c11 12 24 15 37 12" stroke="#f9f2d0" strokeWidth="2" strokeOpacity=".7" strokeLinecap="round" />
      <path d="m66 38 3-7 3 7 7 3-7 3-3 7-3-7-7-3 7-3Zm38-24 2-5 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#f7db91" opacity=".92" />
      <circle cx="28" cy="75" r="2" fill="#e6e4ad"/><circle cx="65" cy="112" r="1.8" fill="#d8c7ff"/><circle cx="171" cy="44" r="2" fill="#e4efb5"/>
    </svg>
  );
}

export function FoxCompanion({ motionEnabled, sceneKey }: { motionEnabled: boolean; sceneKey: string }) {
  const [place, setPlace] = useState({ x: 0, y: 0, ready: false });
  const [reaction, setReaction] = useState(0);
  const [facing, setFacing] = useState(1);
  const currentPerch = useRef<Element | null>(null);
  const lastX = useRef<number | null>(null);

  useEffect(() => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    let frame = 0;
    const anchors = () => [...document.querySelectorAll<HTMLElement>('[data-fox-perch]')];
    const visible = () => anchors().filter((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return rect.top > 30 && rect.top < window.innerHeight - 24;
    });
    const positionAt = (anchor: HTMLElement) => {
      const rect = anchor.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const foxWidth = window.innerWidth <= 720 ? 86 : 128;
      const x = Math.max(6, rect.left - shellRect.left - foxWidth * .55);
      const y = Math.max(78, rect.top - shellRect.top - foxWidth * .73);
      if (lastX.current !== null && x !== lastX.current) setFacing(x >= lastX.current ? 1 : -1);
      lastX.current = x;
      setPlace((previous) => {
        if (previous.ready && previous.x === x && previous.y === y) return previous;
        return { x, y, ready: true };
      });
      currentPerch.current = anchor;
    };
    const findCurrent = () => {
      const available = visible();
      const nearest = available.sort((a, b) => Math.abs(a.getBoundingClientRect().top - window.innerHeight * .43) - Math.abs(b.getBoundingClientRect().top - window.innerHeight * .43))[0];
      if (nearest && nearest !== currentPerch.current) positionAt(nearest);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; findCurrent(); }); };
    const onResize = () => { const anchor = currentPerch.current as HTMLElement | null; if (anchor && document.contains(anchor)) positionAt(anchor); else findCurrent(); };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.app-shell button, .app-shell a')) return;
      if (motionEnabled) setReaction((count) => count + 1);
      if (!motionEnabled || !target.closest('.nav-link, .brand, .button, .source-card, .inbox-row-open, .inbox-context-list button')) return;
      const available = visible();
      if (available.length > 1) {
        const index = Math.max(0, available.indexOf(currentPerch.current as HTMLElement));
        positionAt(available[(index + 1) % available.length]);
      }
    };
    const first = anchors()[0];
    if (first) positionAt(first);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('click', onClick);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    anchors().forEach((anchor) => observer?.observe(anchor));
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); document.removeEventListener('click', onClick); };
  }, [sceneKey, motionEnabled]);

  return <motion.div className={motionEnabled ? 'fox-companion is-animated' : 'fox-companion'} aria-hidden="true" initial={false} animate={{ x: place.x, y: place.y, opacity: place.ready ? 1 : 0 }} transition={{ duration: motionEnabled ? .62 : 0, ease: [0.22, 1, 0.36, 1] }}><motion.div className="spirit-fox-motion" animate={{ y: motionEnabled && reaction ? [0, 8, -28, 0] : 0, rotate: motionEnabled && reaction ? [0, -3, 5, 0] : 0, scaleX: facing }} transition={{ duration: motionEnabled ? .62 : 0, ease: [0.22, 1, 0.36, 1] }}><SpiritFoxDrawing idPrefix="companion-fox" /></motion.div><span className="fox-shadow" /></motion.div>;
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
    <div className="opening-center"><div className="opening-emblem"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="42" /><path d="M60 95V45m0 29C40 75 32 61 27 48m33 14c18 0 27-14 31-24M60 54c-17-8-18-21-19-29m19 20c7-18 14-21 23-22" /></svg></div><span>Enter the story</span><strong>Deeproot</strong><p>Follow the evidence through the forest.</p></div>
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
