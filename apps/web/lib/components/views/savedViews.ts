/**
 * Saved views: a name → the view's query string, per dashboard page, in this
 * browser's localStorage. Every access is wrapped in try/catch (private mode,
 * blocked storage, quota) and degrades to "no saved views". No schema change.
 */
export interface SavedView {
  name: string;
  /** The view's query string, without the leading '?'. */
  query: string;
  savedAt: string;
}

const PREFIX = 'rm:views:';
const MAX_VIEWS = 20;
const MAX_NAME = 60;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function listSavedViews(page: string): SavedView[] {
  try {
    const raw = storage()?.getItem(PREFIX + page);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is SavedView =>
          !!v && typeof v === 'object' && typeof (v as SavedView).name === 'string' && typeof (v as SavedView).query === 'string',
      )
      .slice(0, MAX_VIEWS);
  } catch {
    return [];
  }
}

export function saveView(page: string, name: string, query: string): SavedView[] {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return listSavedViews(page);
  const next = [
    { name: clean, query: query.replace(/^\?/, ''), savedAt: new Date().toISOString() },
    ...listSavedViews(page).filter((v) => v.name !== clean),
  ].slice(0, MAX_VIEWS);
  try {
    storage()?.setItem(PREFIX + page, JSON.stringify(next));
  } catch {
    /* storage unavailable — the view simply isn't persisted */
  }
  return next;
}

export function deleteSavedView(page: string, name: string): SavedView[] {
  const next = listSavedViews(page).filter((v) => v.name !== name);
  try {
    storage()?.setItem(PREFIX + page, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
