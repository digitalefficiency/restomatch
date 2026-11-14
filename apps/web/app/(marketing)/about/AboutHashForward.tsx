'use client';

import { useEffect } from 'react';
import { movedAboutTarget } from './aboutForward.logic';

/** Forwards a moved /about#section deep link to /product#section (no history entry). */
export function AboutHashForward() {
  useEffect(() => {
    const target = movedAboutTarget(window.location.hash, window.location.search);
    if (target) window.location.replace(target);
  }, []);
  return null;
}
