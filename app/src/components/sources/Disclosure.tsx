/**
 * Disclosure — sources.md §5. Limitations & disclosure, three columns:
 * COVERAGE / ACCURACY / INDEPENDENCE.
 */

import { motion, useReducedMotion } from 'framer-motion';

const COLS: Array<{ title: string; body: string }> = [
  {
    title: 'Coverage',
    body: 'ADS-B depends on volunteer receiver density (oceans/poles sparse); AIS layer is Baltic-focused without an aisstream key; satellite set capped at ~1500 for 60fps.',
  },
  {
    title: 'Accuracy',
    body: 'Country-level article geolocation is approximate and labeled; tone is GDELT’s computation; ship/aircraft positions are last-received beacons with ages shown.',
  },
  {
    title: 'Independence',
    body: 'Not affiliated with any government, military, or data provider; all trademarks belong to their owners; built on public data and open-source libraries (CesiumJS, satellite.js).',
  },
];

export default function Disclosure() {
  const reduce = useReducedMotion();
  return (
    <section className="mt-16 border-t border-wf-line pt-8">
      <div className="grid gap-8 md:grid-cols-3">
        {COLS.map((c, i) => (
          <motion.div
            key={c.title}
            initial={reduce ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.4, delay: i * 0.1, ease: 'easeOut' }}
          >
            <h3 className="font-display text-[12px] font-semibold uppercase tracking-[0.14em] text-wf-ink">
              {c.title}
            </h3>
            <p className="mt-2 font-body text-xs leading-5 text-wf-ink-dim">{c.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
