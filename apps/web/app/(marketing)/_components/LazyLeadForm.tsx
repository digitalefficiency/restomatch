'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

/** Roughly the mounted form's height (taller on phones), so mounting in view — e.g. on /#lead — doesn't shift the page. */
const RESERVED = 'min-h-[44rem] sm:min-h-[34rem]';

const LeadForm = dynamic(() => import('./LeadForm').then((m) => m.LeadForm), {
  ssr: false,
  loading: () => <div className={RESERVED} aria-hidden="true" />,
});

/**
 * The lead form sits at the bottom of the landing page, so its JS (tRPC
 * mutation, form state) is fetched only when the section approaches the
 * viewport — or immediately when someone jumps to #lead. Keeps it out of the
 * first-load bundle of `/`. The height is reserved only until the form mounts,
 * so the (shorter) success card isn't left floating in an empty box.
 */
export function LazyLeadForm({
  loadingLabel,
  noscriptLabel,
}: {
  loadingLabel: string;
  noscriptLabel: string;
}) {
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
    <div ref={ref}>
      {show ? (
        <LeadForm />
      ) : (
        <p className={`${RESERVED} py-24 text-center text-sm text-muted`}>
          {loadingLabel}
          <noscript>
            <span className="mt-2 block">{noscriptLabel}</span>
          </noscript>
        </p>
      )}
    </div>
  );
}
