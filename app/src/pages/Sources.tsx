/**
 * Data Sources (/sources) — the provenance registry that proves the
 * no-mock-data contract. Design: design/sources.md. Every status,
 * latency, failure count and score on this page is real: store slice
 * state, browser-measured probes, and a client-side failure counter.
 * The page doubles as a status page when any source is down.
 */

import { useEffect } from 'react';
import SourcesHeader from '@/components/sources/SourcesHeader';
import SourceCard from '@/components/sources/SourceCard';
import TensionMethodology from '@/components/sources/TensionMethodology';
import ZonesTable from '@/components/sources/ZonesTable';
import Disclosure from '@/components/sources/Disclosure';
import { REGISTRY } from '@/components/sources/registry';
import { initFailureCounter, startProbes } from '@/components/sources/probes';

export default function Sources() {
  /* real latency probes + failure counting while this page is open */
  useEffect(() => {
    initFailureCounter();
    const stop = startProbes();
    return stop;
  }, []);

  return (
    <div className="mx-auto max-w-[1440px] px-6 pb-16">
      <SourcesHeader />

      {/* ---- source registry ---- */}
      <section className="mt-12 space-y-3">
        {REGISTRY.map((entry, i) => (
          <SourceCard key={entry.id} entry={entry} index={i} />
        ))}
      </section>

      <TensionMethodology />
      <ZonesTable />
      <Disclosure />
    </div>
  );
}
