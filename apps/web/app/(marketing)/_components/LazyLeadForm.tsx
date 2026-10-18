'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

const LeadForm = dynamic(() => import('./LeadForm').then((m) => m.LeadForm), { ssr: false });

/**
 * The lead form sits at the bottom of the landing page, so its JS (tRPC
 * mutation, form state) is fetched only when the section approaches the
 * viewport — or immediately when someone jumps to #lead. Keeps it out of the
 * first-load bundle of `/`.
 */
export function LazyLeadForm({ loadingLabel }: { loadingLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.location.hash === '#lead' || !('IntersectionObserver' in window)) {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    const onHash = () => window.location.hash === '#lead' && setShow(true);
    window.addEventListener('hashchange', onHash);
    return () => {
      io.disconnect();
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  return (
    <div ref={ref} className="min-h-[26rem]">
      {show ? (
        <LeadForm />
      ) : (
        <p className="py-24 text-center text-sm text-muted" aria-live="polite">
          {loadingLabel}
        </p>
      )}
    </div>
  );
}
