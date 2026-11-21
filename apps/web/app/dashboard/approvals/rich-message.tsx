'use client';

/**
 * Folds the pieces into nested fragments: every piece sits in a static child position, so React needs no keys and
 * no wrapper element is added. (No `Fragment` import: the workspace hoists two @types/react copies, and a component
 * imported from 'react' does not type-check against the global JSX namespace — lib/i18n/client.tsx.)
 */
function chain(parts: readonly React.ReactNode[], from = 0): React.ReactNode {
  if (from >= parts.length) return null;
  return (
    <>
      {parts[from]}
      {chain(parts, from + 1)}
    </>
  );
}

/**
 * React nodes in a message's {placeholders} (DS3-04 spec §2.8). The file is not `template.tsx`: that is a reserved
 * Next.js segment file and would wrap every route under approvals/ (P1).
 *
 * `text` is split on `{name}`: a string or number value renders as `<bdi className="num">` (isolated, and its digits
 * tabular — Google Sans digits outside `.num` are proportional, §11.1); a React element renders as it is, with no
 * wrapper (the head's first `<bdi>` must be the count, W1-07:201); a missing value keeps the placeholder text, as
 * `t()` leaves a placeholder it has no value for (lib/i18n/translate.ts). null / false render nothing.
 */
export function Template({ text, values }: { text: string; values: Record<string, React.ReactNode> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const name = m[1] ?? '';
    const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
      parts.push(<bdi className="num">{value}</bdi>);
    } else if (value === undefined) {
      parts.push(m[0]); // missing: the placeholder text stays
    } else if (value !== null && typeof value !== 'boolean') {
      parts.push(value); // a React element (or any other node): as it is
    }
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{chain(parts)}</>;
}
