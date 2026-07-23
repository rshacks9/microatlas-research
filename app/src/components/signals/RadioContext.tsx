import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { liveatcStreamUrl } from './signalsData';
import type { AtcFeed } from './signalsData';

export type PlayStatus = 'idle' | 'connecting' | 'live' | 'error';

interface RadioContextValue {
  active: AtcFeed | null;
  status: PlayStatus;
  volume: number;
  /** AnalyserNode wired to the live stream when CORS allows; null = fallback EQ. */
  analyser: AnalyserNode | null;
  play: (feed: AtcFeed) => void;
  stop: () => void;
  retry: () => void;
  setVolume: (v: number) => void;
}

const RadioContext = createContext<RadioContextValue | null>(null);

export function useRadio(): RadioContextValue {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error('useRadio must be used inside <RadioProvider>');
  return ctx;
}

/**
 * Single-stream radio engine. One shared <audio> element guarantees the
 * single-stream rule: starting any feed stops the previous one.
 * Stream URL: https://d.liveatc.net/{feed_id} (302 -> https icecast stream).
 * d.liveatc.net sends Access-Control-Allow-Origin:* so we first attempt
 * crossOrigin='anonymous' + AnalyserNode for a real EQ. If a browser/host
 * blocks that, we retry once in plain mode — playback still works, the EQ
 * falls back to a calm synthetic cycle.
 */
export function RadioProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<AtcFeed | null>(null);
  const [status, setStatus] = useState<PlayStatus>('idle');
  const [volume, setVolumeState] = useState(0.8);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const activeRef = useRef<AtcFeed | null>(null);
  const volumeRef = useRef(0.8);
  const corsFailedRef = useRef(false);
  const plainRetriedRef = useRef(false);

  const ensureGraph = useCallback((el: HTMLAudioElement) => {
    try {
      if (!ctxRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctxRef.current = new Ctor();
      }
      const ctx = ctxRef.current;
      void ctx.resume().catch(() => undefined);
      const source = ctx.createMediaElementSource(el);
      const node = ctx.createAnalyser();
      node.fftSize = 64;
      node.smoothingTimeConstant = 0.72;
      source.connect(node);
      node.connect(ctx.destination);
      setAnalyser(node);
    } catch {
      setAnalyser(null);
    }
  }, []);

  const teardownAudio = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      audioRef.current = null;
    }
  }, []);

  const play = useCallback(
    (feed: AtcFeed) => {
      activeRef.current = feed;
      setActive(feed);
      setStatus('connecting');

      const wantCors = !corsFailedRef.current;
      let el = audioRef.current;
      if (!el || el.dataset.cors !== String(wantCors)) {
        teardownAudio();
        setAnalyser(null);
        el = new Audio();
        el.preload = 'none';
        if (wantCors) el.crossOrigin = 'anonymous';
        el.dataset.cors = String(wantCors);

        el.addEventListener('playing', () => {
          if (audioRef.current !== el) return;
          setStatus('live');
        });
        el.addEventListener('waiting', () => {
          if (audioRef.current !== el) return;
          if (activeRef.current) setStatus('connecting');
        });
        el.addEventListener('error', () => {
          if (audioRef.current !== el) return;
          const current = audioRef.current;
          if (current && current.dataset.cors === 'true' && !plainRetriedRef.current) {
            // CORS/analyser path blocked — retry once in plain mode (playback-first).
            plainRetriedRef.current = true;
            corsFailedRef.current = true;
            const f = activeRef.current;
            if (f) play(f);
            return;
          }
          if (activeRef.current) setStatus('error');
        });

        audioRef.current = el;
      }

      el.volume = volumeRef.current;
      if (wantCors) ensureGraph(el);
      el.src = liveatcStreamUrl(feed.id);
      el.play().catch(() => {
        if (activeRef.current) setStatus('error');
      });
    },
    [ensureGraph, teardownAudio],
  );

  const stop = useCallback(() => {
    activeRef.current = null;
    setActive(null);
    setStatus('idle');
    plainRetriedRef.current = false;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  }, []);

  const retry = useCallback(() => {
    const f = activeRef.current;
    if (!f) return;
    plainRetriedRef.current = false;
    play(f);
  }, [play]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      if (ctxRef.current) void ctxRef.current.close().catch(() => undefined);
    };
  }, []);

  const value = useMemo<RadioContextValue>(
    () => ({ active, status, volume, analyser, play, stop, retry, setVolume }),
    [active, status, volume, analyser, play, stop, retry, setVolume],
  );

  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
}
