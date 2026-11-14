'use client';

/**
 * The shared draft + leave-guard kit (W2-15, deep-fix class 2: field work is
 * never lost). Client-only: import from `@/lib/drafts`, never from the
 * `lib/components` barrel (which server code also imports).
 *
 *   const draft = useFormDraft('count:' + poId, initial, { version: 1, ttlMs: DAY });
 *   const { leave } = useLeaveGuard(dirty, setLeaveTarget);   // + overlay/Sheet
 *   useSaveShortcut(save);                                    // Ctrl/⌘+S on any layout
 *   clearDraftsForUser(userId);                               // on sign-out
 */
export { useLeaveGuard, attachLeaveGuard, syncGuardEntry, leaveNow } from './leaveGuard';
export type { LeaveTarget, LeaveGuardEnv, LeaveGuardState } from './leaveGuard';
export { useFormDraft, DraftScopeProvider, useDraftScope } from './useFormDraft';
export type { FormDraft, FormDraftOptions } from './useFormDraft';
export { useServerDraft } from './useServerDraft';
export type { ServerDraft, ServerDraftOptions } from './useServerDraft';
export { createServerDraft, isNetworkFailure } from './serverDraft';
export type {
  ServerDraftStatus,
  ServerDraftSnapshot,
  ServerDraftSaveOptions,
  ServerDraftSaveResult,
  ServerDraftController,
  LocalCopy,
} from './serverDraft';
export { useSaveShortcut, isSaveShortcut, attachSaveShortcut } from './saveShortcut';
export {
  clearDraftsForUser,
  draftKey,
  readDraftEnvelope,
  writeDraftEnvelope,
  removeDraft,
  DRAFT_PREFIX,
} from './store';
export type { DraftScope, DraftEnvelope, StorageLike } from './store';
