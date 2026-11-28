/**
 * W3-03b · when to offer "install the app". Pure policy over a tiny persisted
 * state (localStorage, per device):
 * - offer only after the 2nd completed task (a delivery closed, a count sent…),
 * - never again for 14 days after an ask (accepted, dismissed or ignored),
 * - never when already installed (standalone display, or after `appinstalled`).
 * Android/Chrome: the deferred `beforeinstallprompt` → `prompt()`. iOS Safari
 * has no prompt: a 3-step coach (Share → Add to Home Screen → Add).
 * After an install, ask the browser to keep the field data (`storage.persist()`).
 */

export const INSTALL_KEY = 'rm.pwa.install.v1';
export const TASKS_BEFORE_ASK = 2;
export const REASK_AFTER_MS = 14 * 24 * 3600 * 1000;
/** Dispatched by any flow that finished a field task (also counted: a field-outbox drain that sent work). */
export const TASK_COMPLETED_EVENT = 'rm-task-completed';

export interface InstallState {
  completed: number;
  lastAskedAt: number | null;
  installed: boolean;
}
export const EMPTY_STATE: InstallState = { completed: 0, lastAskedAt: null, installed: false };

export type Platform = 'prompt' | 'ios' | 'none';

export function parseState(raw: string | null | undefined): InstallState {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<InstallState>) : {};
    return {
      completed: Math.max(0, Math.floor(Number(v.completed) || 0)),
      lastAskedAt: typeof v.lastAskedAt === 'number' && Number.isFinite(v.lastAskedAt) ? v.lastAskedAt : null,
      installed: v.installed === true,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function withCompletedTask(s: InstallState): InstallState {
  return { ...s, completed: Math.min(s.completed + 1, 1000) };
}
export function withAsked(s: InstallState, now: number): InstallState {
  return { ...s, lastAskedAt: now };
}
export function withInstalled(s: InstallState): InstallState {
  return { ...s, installed: true };
}

export function shouldOffer(s: InstallState, now: number, platform: Platform, standalone: boolean): boolean {
  if (platform === 'none' || standalone || s.installed) return false;
  if (s.completed < TASKS_BEFORE_ASK) return false;
  return s.lastAskedAt == null || now - s.lastAskedAt >= REASK_AFTER_MS;
}

/** iOS Safari (incl. iPadOS that reports as Mac with touch) — no install prompt there. */
export function isIosSafari(ua: string, maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Read/write through a Storage-like object; a blocked storage never throws. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
export function loadState(kv: KV | null): InstallState {
  try {
    return parseState(kv?.getItem(INSTALL_KEY));
  } catch {
    return { ...EMPTY_STATE };
  }
}
export function saveState(kv: KV | null, s: InstallState): void {
  try {
    kv?.setItem(INSTALL_KEY, JSON.stringify(s));
  } catch {
    // Private mode / quota: the policy just asks again later.
  }
}

/** Ask the browser to keep this origin's storage (the offline outbox). Never throws. */
export async function persistStorage(storage: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } | undefined): Promise<boolean> {
  try {
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
