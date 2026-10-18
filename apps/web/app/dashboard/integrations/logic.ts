/** Pure helpers for the integrations page (unit-tested). */

/** Mirrors the server's account-code rule (integrations.setAccountingConfig). */
export const ACCOUNT_CODE_RE = /^[\p{L}\p{N}._-]{0,15}$/u;

export function accountCodeProblem(value: string, required: boolean): 'required' | 'invalid' | null {
  const v = value.trim();
  if (!v) return required ? 'required' : null;
  return ACCOUNT_CODE_RE.test(v) ? null : 'invalid';
}

export interface MappingForm {
  expenseAccount: string;
  vatInputAccount: string;
  movementType: string;
  /** supplierId → code ('' = use the default). */
  supplierAccounts: Record<string, string>;
}

export function mappingProblems(form: MappingForm): Record<string, 'required' | 'invalid'> {
  const out: Record<string, 'required' | 'invalid'> = {};
  const check = (key: string, v: string, required: boolean) => {
    const p = accountCodeProblem(v, required);
    if (p) out[key] = p;
  };
  check('expenseAccount', form.expenseAccount, true);
  check('vatInputAccount', form.vatInputAccount, true);
  if (!form.movementType.trim()) out.movementType = 'required';
  else if (form.movementType.trim().length > 3) out.movementType = 'invalid';
  for (const [id, code] of Object.entries(form.supplierAccounts)) check(`supplier:${id}`, code, false);
  return out;
}

/** Trimmed payload; blank supplier codes are dropped (= default). */
export function mappingPayload(form: MappingForm): MappingForm {
  return {
    expenseAccount: form.expenseAccount.trim(),
    vatInputAccount: form.vatInputAccount.trim(),
    movementType: form.movementType.trim(),
    supplierAccounts: Object.fromEntries(
      Object.entries(form.supplierAccounts)
        .map(([id, c]) => [id, c.trim()] as const)
        .filter(([, c]) => c.length > 0),
    ),
  };
}

export type PosErrorKey = 'NO_COLUMNS' | 'EMPTY' | 'TOO_MANY_ROWS' | 'TOO_LARGE' | 'NO_ROWS';

/** `POS_FILE_NO_COLUMNS:qty,net` → { key, missing }. Null for any other error. */
export function posErrorOf(err: unknown): { key: PosErrorKey; missing: string[] } | null {
  const msg = (err as { message?: unknown } | null)?.message;
  if (typeof msg !== 'string') return null;
  const m = /^POS_FILE_(NO_COLUMNS|EMPTY|TOO_MANY_ROWS|TOO_LARGE|NO_ROWS)(?::(.*))?$/.exec(msg);
  if (!m) return null;
  return { key: m[1] as PosErrorKey, missing: m[2] ? m[2].split(',').filter(Boolean) : [] };
}

/** Client-side cap that mirrors the server's 5 MB POS file limit. */
export const MAX_POS_FILE_BYTES = 5 * 1024 * 1024;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** base64 → bytes for a Blob (the file keeps its package encoding: no re-encoding). */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
