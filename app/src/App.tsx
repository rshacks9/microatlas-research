/**
 * App root — routing + global live polling + global overlays.
 * Pattern B (nested routes): scroll pages render inside <Layout/> via
 * <Outlet/>; the deck route is standalone (no footer, no Lenis).
 */

import { useEffect } from 'react';
import { Routes, Route } from 'react-router';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Conflicts from '@/pages/Conflicts';
import Tracking from '@/pages/Tracking';
import Signals from '@/pages/Signals';
import Intel from '@/pages/Intel';
import Sources from '@/pages/Sources';
import { startLivePolling } from '@/lib/poller';

export default function App() {
  useEffect(() => {
    startLivePolling();
  }, []);

  return (
    <>
      <Routes>
        {/* Command Deck — full-viewport instrument, no footer/Lenis */}
        <Route path="/" element={<Home />} />

        {/* Scroll pages share Navbar + Footer + Lenis via Layout */}
        <Route element={<Layout />}>
          <Route path="/conflicts" element={<Conflicts />} />
          <Route path="/tracking" element={<Tracking />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/intel" element={<Intel />} />
          <Route path="/sources" element={<Sources />} />
        </Route>
      </Routes>

      {/* global grain + scanline overlays (below modals, above content) */}
      <div className="wf-noise" aria-hidden />
      <div className="wf-scanlines" aria-hidden />
    </>
  );
}
