import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

/**
 * Shared chrome for the legal pages (privacy / terms / cookies). Renders a
 * prominent reviewer banner making it unmistakable that the copy is a
 * placeholder draft pending counsel sign-off, and a legend for the
 * `[לאימות עו"ד]` marker that tags every substantive legal sentence.
 *
 * IMPORTANT (engineering note, not legal advice): the page bodies contain NO
 * invented statutory citations, deadlines, or guarantees — only structure and
 * neutral descriptions, each sentence tagged for a lawyer to verify or replace.
 */
export function LegalShell({
  title,
  intro,
  lastUpdated,
  children,
}: {
  title: string;
  intro?: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div
        role="note"
        className="mb-8 rounded-2xl border-r-4 border-gold bg-gold/8 px-5 py-4 text-sm leading-relaxed text-ink"
      >
        <div className="mb-1 flex items-center gap-2 font-bold text-gold">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          טיוטה לבדיקת עורך/ת דין
        </div>
        <p className="text-muted">
          מסמך זה הוא שלד ראשוני בלבד ואינו ייעוץ משפטי. כל משפט מהותי מסומן בתגית{' '}
          <span className="whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-gold">
            [לאימות עו&quot;ד]
          </span>{' '}
          ומחייב אימות, השלמה או החלפה בידי עורך/ת דין לפני פרסום מחייב. אין
          להסתמך על נוסח זה כפי שהוא.
        </p>
      </div>

      <div className="mb-2 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
      <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {intro ? <p className="mt-4 text-lg leading-relaxed text-muted">{intro}</p> : null}
      <p className="mt-3 font-mono text-xs tabular-nums text-subtle">
        עודכן לאחרונה: {lastUpdated} · [לאימות עו&quot;ד]
      </p>

      <div className="legal-body mt-10 space-y-8 text-[15px] leading-relaxed text-muted">
        {children}
      </div>

      <div className="mt-12 border-t border-line pt-6 text-sm text-subtle">
        מסמכים קשורים:{' '}
        <Link href="/privacy" className="text-muted underline hover:text-ink">
          מדיניות פרטיות
        </Link>
        {' · '}
        <Link href="/terms" className="text-muted underline hover:text-ink">
          תנאי שימוש
        </Link>
        {' · '}
        <Link href="/cookies" className="text-muted underline hover:text-ink">
          מדיניות עוגיות
        </Link>
      </div>
    </div>
  );
}

/**
 * A substantive legal clause. The `[לאימות עו"ד]` marker is appended
 * automatically so no clause can ship untagged.
 */
export function LegalClause({ children }: { children: React.ReactNode }) {
  return (
    <p>
      {children}{' '}
      <span className="whitespace-nowrap font-mono text-xs text-gold/80">[לאימות עו&quot;ד]</span>
    </p>
  );
}

/** A titled legal section. */
export function LegalSection({
  id,
  heading,
  children,
}: {
  id?: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-xl font-bold text-ink">{heading}</h2>
      {children}
    </section>
  );
}
