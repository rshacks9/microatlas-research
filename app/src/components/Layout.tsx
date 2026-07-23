/**
 * Layout for scroll pages (pattern B — nested routes, <Outlet/>).
 * Navbar is sticky (normal flow, no offset bookkeeping); Lenis smooth
 * scroll is enabled here only — the deck route opts out entirely.
 */

import { useEffect } from 'react';
import { Outlet } from 'react-router';
import Lenis from 'lenis';
import Navbar from './Navbar';
import Footer from './Footer';

export default function Layout() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ lerp: 0.11 });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-bg-0 text-wf-ink">
      <Navbar />
      <main>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
