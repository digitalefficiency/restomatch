# Copy focus: explanations stay in place, but efficient (mechanism spec)

**For:** engineers on Batch P (pilot, train B) and W2-16 "copy focus" (the wave-2 package id from `trains.md`). **Status:** proposal, 31.10.2026. **Source of truth:** `rw-release` @ `11ea29ce`. Line numbers below are from that tree; re-grep after you rebase.
**Owner request (31.10):** "למקד טקסטים בתוך המערכת". Clarified a few minutes later: no central place. Explanations stay where they are, made efficient.
**Out of scope:** a help centre, a glossary page, the marketing site, legal pages, `/showcase`, and e-mails.

## 0. The pattern in three lines
1. A working screen leads with the figure, the status and the action. Every explanation gets one of four treatments: **cut** it, **shorten** it to one sentence of ≤12 words, **share** it (one catalog key that every screen references), or **fold** it.
2. The fold is one component, `<Explain>`. It is a visible text toggle ("למה?" / "פרטים" / "איך חישבנו?") placed right next to the thing it explains. It is a ≥44 px button with `aria-expanded` and `aria-controls`, and it expands inline on the same screen, collapsed by default. It is never a popover or a sheet, and it never folds a ₪ confirmation or anything needed to act.
3. A cheap guard keeps it that way. A unit test caps catalog strings by class (visible 12 words, folded 40, toast 8, button 4) using a ratchet allowlist, and fails on exact duplicate explanations. An e2e word budget per screen type also ratchets down from today's measurements.

## 1. Which treatment? (decide in this order)
| # | Question | If yes |
|---|---|---|
| 1 | Is it legal text, a ₪/destructive confirmation, a blocking reason, a deadline, the approvals `WhyLine` evidence, or an a11y name? | **Keep visible.** Never fold or cut these. a11y names may be shortened only. |
| 2 | Does the screen already say it (title, column, button, badge), or is it obvious to someone doing the task? | **Cut.** |
| 3 | Does the same idea appear on another screen? | **Share:** one key (§3). Then go on to 4 for how it renders. |
| 4 | Does it fit in one sentence of ≤12 words, and does the user need it every time? | **Shorten**, and keep it visible. |
| 5 | Is it longer than that, or needed only sometimes? | **Fold** with `<Explain>` (§2). |

Receiver and chef field screens: prefer **cut** over fold. A receiver flow that needs explaining needs a better flow, and every fold there also needs four receiver-language overlays (§3.5).

## 2. The fold: `<Explain>`

### 2.1 Reuse first: what exists and why it is not enough
| Existing | Where | Verdict |
|---|---|---|
| `ViewDisclosure` | `apps/web/app/dashboard/home/view-disclosure.tsx` | It is the right markup: a `<button>` with `aria-expanded` and `aria-controls`, `min-h-11`, and a `hidden` panel. But it is home-specific: a hard-coded id `home-view-toolbar`, a chip style with a `SlidersHorizontal` icon, and copy from `overview`. **Extract its logic** into `useDisclosure()` (below). W2-08 may move `ViewDisclosure` onto the hook later (optional). |
| Native `<details>` | home trend, needs-you "more", approvals "others", chain rows, the wizard's other-date picker, POS issues | These hide **content**, not explanations. Keep them; `Explain` does not replace them. `<details>` can't serve as the fold for three reasons. `<summary>` must be the first child, so the toggle can't sit at the end of a status line with the panel below the row. It gives no `aria-controls`. And the icon-only summaries measured only **24 px** on desktop (LeakHero ⓘ, `mech--owner-home--desktop-top.jpg`). |
| `ToolbarPopover` (`lib/components/table/Popover.tsx`), `Sheet`, LeakHero ⓘ `calcNote` (`lib/components/hero/LeakHero.tsx:144-158`, an absolutely positioned note) | — | Overlays cover the task. The requirement is inline. The LeakHero ⓘ popover is the pattern to **retire** (§6.4). |
| `Banner`, `InlineMessage` (`lib/components/feedback/Banner.tsx`) | — | `Banner` is for page-level T2 act-now items and live outcomes only. It must not carry explanations (§4). |
| `WhyLine` (`lib/components/flags/WhyLine.tsx`) | approvals | This is evidence, not prose: numbers first, one line, clamped, never dropped. **Keep it visible.** It is the model for "numbers before words". |

### 2.2 Files (new unless marked)
- `apps/web/lib/components/Explain.tsx`: `useDisclosure`, `ExplainToggle`, `ExplainPanel`, `Explain` (~70 lines). A new file in W2-15's folder; request the path addition plus one barrel line in `lib/components/index.ts`.
- `apps/web/lib/components/__tests__/explain.test.tsx`: render, toggle, ids and labels (import `reactGlobal.ts` first).
- `apps/web/lib/components/PageHeader.tsx` (W2-15): an optional `explain` prop (§2.3). This goes through W2-15's primitive-fix queue (≤2 working days).
- `apps/web/lib/i18n/messages/explain/{he,en,index}.ts` and `explain.receiver.ts`: the shared strings and the toggle labels (§3). This is a new namespace, which W2-13 registers in `messages/index.ts` on request (SLA one working day).
- `apps/web/lib/copy/{words.ts,classify.ts,walk.ts,budget.allow.ts,screens.ts}` and `apps/web/lib/copy/__tests__/copy-budget.test.ts` (§5). This is a new folder that W2-16 owns.
- `apps/web/e2e/W2-16.spec.ts` and `apps/web/e2e/helpers/copyBudget.ts` (§5.4).

### 2.3 API
```ts
export type ExplainLabel = 'why' | 'details' | 'how';
// why     → "למה?"        a reason behind a status, number or rule (why pending, why not counted)
// details → "פרטים"       supporting conditions or steps that are not a reason (what is included, deadlines' legal basis)
// how     → "איך חישבנו?" only next to a ₪ figure we computed (hero, tiles, totals)

/** Low-level: any layout. The panel MUST follow the toggle's row in DOM order, with nothing focusable in between. */
export function useDisclosure(id?: string): {
  open: boolean;
  toggleProps: { type: 'button'; 'aria-expanded': boolean; 'aria-controls': string; onClick: () => void };
  panelProps: { id: string; hidden: boolean; ref: React.RefObject<HTMLDivElement | null> };
};

export function ExplainToggle(p: ReturnType<typeof useDisclosure>['toggleProps'] & {
  label?: ExplainLabel;   // default 'why'
  about: string;          // REQUIRED, ≤4 words: sr-only suffix that makes the name unique ("למה? · ממתינות לשיוך")
  className?: string;
}): JSX.Element;

export function ExplainPanel(p: ReturnType<typeof useDisclosure>['panelProps'] & {
  children: string;       // text only: no links, buttons, inputs or ₪ (§3.4)
  className?: string;
}): JSX.Element;

/** The common case: one visible line + its toggle on the same row, the panel below. */
export function Explain(p: {
  line?: React.ReactNode; // the visible status/number/heading this explains; omit to place the toggle alone
  body: string;           // from a catalog key under `explain.*` (§3); ≤40 words; may join a local key + a shared key
  about: string;          // ≤4 words, unique on the page
  label?: ExplainLabel;
  id?: string;            // stable id → `${id}-panel`; default useId()
  testId?: string;
  className?: string;
}): JSX.Element;

// PageHeader (W2-15) gains:
explain?: { body: string; about: string; label?: ExplainLabel };
// The toggle goes at the end of the context line (or after the h1 when there is no context line).
// The panel goes directly under the header, before the page content. This is the one sanctioned home
// for a page's "why this page" text that used to be a subtitle.
```

### 2.4 Markup and a11y contract
```html
<div class="min-w-0" data-explain="pending">
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <span class="min-w-0">…line…</span>
    <button type="button" aria-expanded="false" aria-controls="pending-panel" data-explain-toggle>
      למה?<span class="sr-only"> · ממתינות לשיוך</span><svg aria-hidden="true">…chevron…</svg>
    </button>
  </div>
  <div id="pending-panel" hidden data-explain-panel><p>…body…</p></div>
</div>
```
- **Button, not a link.** Enter and Space toggle it, as on any native button. There is no Esc binding (the APG disclosure pattern) and no focus trap. **Focus stays on the toggle** when the panel opens and when it closes.
- **The name is the visible label plus an sr-only `about` suffix**, so several "למה?" toggles on one page stay distinguishable. Label-in-name (WCAG 2.5.3) holds because the visible text comes first. No `aria-label` and no `title` tooltip.
- **The panel** is a plain `div` with `hidden`. It gets no `role="region"` (that would be landmark noise) and is not a live region: SR users hear "expanded" on the toggle and read on, since the panel is next in reading order. Do not use `aria-describedby` for the body; it would be announced while collapsed.
- **Target:** `min-h-11 min-w-11` (44 px) everywhere. Inside `[data-mode='field']` (receiving wizard, orders field mode) it is `min-h-12` (48 px, DoD-7). The visible type stays `text-body-sm`; the height comes from padding, not a bigger font.
- **On open,** when the panel's bottom is under the sticky chrome, `panel.scrollIntoView({ block: 'nearest' })` brings it into view. The global `scroll-padding-bottom` already includes `--rm-bottomnav-h`, `--rm-actionbar-h` and `--consent-h`. This moves the viewport, never the focus.
- **No CLS on load.** It renders collapsed on the server and the client. Opening shifts layout only after user input, so CLS excludes it and the DoD-7 ≤0.05 budget is unaffected.
- **Find-in-page** (optional v2): `hidden="until-found"` with `onbeforematch → open` lets Ctrl+F reveal folded text. Ship it only after it is verified on React 19.0 / Next 15.5; v1 uses plain `hidden`.

### 2.5 Visual (tokens only; no new tokens)
| Part | Classes | Notes |
|---|---|---|
| Toggle | `group inline-flex min-h-11 min-w-11 items-center gap-1 rounded-control px-2 -mx-2 text-body-sm font-semibold text-primary hover:underline [[data-mode=field]_&]:min-h-12 print:hidden` | `text-primary` #066B4A is 6.6:1 on `surface` and 5.8:1 on `surface-2`. This matches the existing green text actions ("לכל עליות המחיר"). The focus ring is the global `:focus-visible` (2 px `--c-focus`, 3 px in field mode). |
| Chevron | lucide `ChevronDown` `h-4 w-4 motion-safe:transition-transform motion-safe:duration-micro group-aria-expanded:rotate-180` | Symmetric, so it never mirrors in RTL. Reduced motion is already neutralised globally. |
| Panel | `mt-1 max-w-prose border-s-2 border-line ps-3 text-body-sm text-muted print:!block` | It is a quiet rule on the inline-start side (the right in he), not a box. `text-muted` is 6.3:1 on `surface-2`, so it also works inside T4 panels. Print shows the text and hides the toggle. |
| Tone | none | A fold has no tone. Inside a T4 (pending/מרכזת) row it inherits the row's neutral look, never warn or danger. |

### 2.6 States
| State | Look | Behaviour |
|---|---|---|
| Collapsed (default) | label + ⌄ | `aria-expanded="false"`, panel `hidden` |
| Expanded | label + ⌃, panel below | `aria-expanded="true"`; focus stays put |
| Hover / focus-visible | underline / global ring | — |
| Field mode | 48 px target, 3 px ring | — |
| Print | panel shown, toggle hidden | — |
| Forced colours | button text uses system colours; chevron `currentColor` | — |
| Disabled / loading | **does not exist** | A fold is never disabled. If there is no body, render no toggle. |

### 2.7 Placement rules
1. Put the toggle **next to what it explains**: at the inline end of the same line (the left in he), on the status line of a card or row, or after an h2 text. Never in a table cell. For a table, place it in the column header or in the row's peek.
2. Allow **at most one fold per card or row** and three per screen. A screen that needs more is a rewrite, not a fold.
3. **Never nest** a fold, and **never fold inside**: `ConfirmDialog` (money confirmations pass `amount` + `party` and stay fully visible), `Toast`, `Banner`, `EmptyState`, error messages, `WhyLine`, `DeadlineChip`, or legal blocks.
4. Never put anything **needed to act** in the panel: no amounts, no deadlines, no buttons, no links. The panel body is text only (`children: string`).
5. Chef and receiver: the panel never contains ₪ (§3.4), so a shared body is safe for every role.
6. Explanations never go in a `title=` attribute; it is invisible on touch and to keyboard. A truncation `title` holding the full name is fine.

### 2.8 Remember-open per user: **not worth it (v1).**
- It defeats the goal, because a fold that stays open is an unfolded explanation.
- It costs a hydration mismatch or a flash (the server renders it closed), plus storage per device.
- The useful signal is the opposite. A fold that people keep opening holds information the screen needs, so **promote a short version to the visible line**; don't persist the fold open. If product analytics ever lands, log `explain_open {id}` to find these. No analytics exists in the app today.

### 2.9 ASCII sketches (he, RTL)
Phone 390×844: chef stock count. The fold sits on the status line, and the field action bar is never covered.
```
┌──────────────────────────────────────────────┐
│ ‹ מלאי                           ספירת מלאי  │  h1 (the old subtitle is cut)
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ [ ⌄ למה? ]        3 פריטים לא נספרו  ⧗   │ │  T4 neutral status line; toggle ≥44 px at inline end
│ └──────────────────────────────────────────┘ │  aria-expanded="false"
│   עגבניות           [ − ]  12  [ + ]         │
│   בצל               [ − ]  __  [ + ]         │
├──────────────────────────────────────────────┤
│        [        סגרו ספירה        ]  56 px   │  sticky field bar (DoD-7)
└──────────────────────────────────────────────┘
after a tap (same screen; the rows move down, nothing overlays):
│ ┌──────────────────────────────────────────┐ │
│ │ [ ⌃ למה? ]        3 פריטים לא נספרו  ⧗   │ │  aria-expanded="true", focus still here
│ │    שורה ריקה היא "לא נספר", לא אפס. ┃   │ │  panel: border-s-2 (right side in RTL),
│ │                היא לא נכנסת לשווי. ┃   │ │  text-body-sm, muted, no ₪
│ └──────────────────────────────────────────┘ │
```
Desktop 1440×900: owner home. A section-header fold uses a shared string, and a card fold sits next to its figure.
```
┌───────────────────────────────────────────────────────────────────────────────┬────────┐
│                                   [ ⌄ למה? ]  מחירים שעלו · 30 יום אחרונים    │ sidebar│
│  ┌ +7.9% ┐ ┌ +10.6% ┐ ┌ +7.2% ┐                                              │        │
│                                                                               │        │
│  ┌──────────────────────────────┐                                             │        │
│  │                  מע״מ בסיכון │  card (T2)                                  │        │
│  │   1,123 ₪ · חשבונית אחת      │  numbers first                              │        │
│  │                  [ ⌄ למה? ]  │                                             │        │
│  │ [ בקשו מהספק מספר הקצאה ]    │  the action is never inside the fold        │        │
│  └──────────────────────────────┘                                             │        │
expanded:
│                                   [ ⌃ למה? ]  מחירים שעלו · 30 יום אחרונים    │
│                                  מדד נפרד. לא נספר בדליפה של החודש.  ┃        │  explain.separateFromLeak
```

### 2.10 Reference implementation (not final; W2-16 owns the real one)
```tsx
'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { explain as explainNs } from '@/lib/i18n/messages/explain';
import { cn } from './cn';

export type ExplainLabel = 'why' | 'details' | 'how';

export function useDisclosure(idProp?: string) {
  const auto = useId().replace(/[^A-Za-z0-9_-]/g, ''); // React 19 ids carry ':' or '«»'
  const id = idProp ?? `x-${auto}`;
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  useEffect(() => {
    if (open && touched.current) panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  return {
    open,
    toggleProps: {
      type: 'button' as const,
      'aria-expanded': open,
      'aria-controls': `${id}-panel`,
      onClick: () => { touched.current = true; setOpen((o) => !o); },
    },
    panelProps: { id: `${id}-panel`, hidden: !open, ref: panelRef },
  };
}

export function ExplainToggle({ label = 'why', about, className, ...p }:
  ReturnType<typeof useDisclosure>['toggleProps'] & { label?: ExplainLabel; about: string; className?: string }) {
  const t = useT(explainNs);
  return (
    <button {...p} data-explain-toggle className={cn(
      'group -mx-2 inline-flex min-h-11 min-w-11 items-center gap-1 rounded-control px-2 text-body-sm font-semibold text-primary hover:underline',
      '[[data-mode=field]_&]:min-h-12 print:hidden', className)}>
      {t(`toggle.${label}`)}
      <span className="sr-only"> · {about}</span>
      <ChevronDown aria-hidden="true"
        className="h-4 w-4 motion-safe:transition-transform motion-safe:duration-micro group-aria-expanded:rotate-180" />
    </button>
  );
}

export function ExplainPanel({ children, className, ref, ...p }:
  ReturnType<typeof useDisclosure>['panelProps'] & { children: string; className?: string }) {
  return (
    <div {...p} ref={ref} data-explain-panel
      className={cn('mt-1 max-w-prose border-s-2 border-line ps-3 text-body-sm text-muted print:!block', className)}>
      <p>{children}</p>
    </div>
  );
}

export function Explain({ line, body, about, label, id, testId, className }:
  { line?: React.ReactNode; body: string; about: string; label?: ExplainLabel; id?: string; testId?: string; className?: string }) {
  const d = useDisclosure(id);
  if (!body) return line ? <>{line}</> : null;
  return (
    <div className={cn('min-w-0', className)} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {line ? <div className="min-w-0">{line}</div> : null}
        <ExplainToggle {...d.toggleProps} label={label} about={about} />
      </div>
      <ExplainPanel {...d.panelProps}>{body}</ExplainPanel>
    </div>
  );
}
```
Unit tests (`explain.test.tsx`): the toggle has `aria-expanded=false` and an `aria-controls` that points at an existing `hidden` panel. A click flips both, and `document.activeElement` is still the toggle. The accessible name starts with the visible label. With an empty `body`, no toggle renders. Two instances get distinct ids.

## 3. Shared explanation strings (one key, many screens)

### 3.1 Where the keys live
| Scope of the idea | Key | Owner |
|---|---|---|
| Used by screens of **two or more namespaces** | `explain.<concept>` in the new namespace `apps/web/lib/i18n/messages/explain/` | W2-16 (later whoever owns copy). Other packages request additions; they never write here. |
| Used only inside **one namespace's screens** | `<ns>.explain.<concept>` inside that namespace | the namespace owner |
| Toggle labels | `explain.toggle.{why,details,how}` | W2-16 |

Why a new namespace and not `common.explain.*`: `common` belongs to W2-13. Its receiver-locale contract is "shell resilience only", and every addition there would compete with the W2-13 copy-gate and the W1-08 sweep. A dedicated namespace gives one owner and one file to review, and the guard can apply stricter rules to it (§3.4, §5.3). Cost: one registration line in `messages/index.ts` (W2-13, on request). If the orchestrator prefers `common`, the same content goes in a new `common/explain.ts` file merged as `explain` by one spread line in `common/index.ts`, the way `components/ds.ts` is merged. The rest of this spec is unchanged in that case.

### 3.2 Naming
- `concept` is a camelCase noun phrase for the **idea**, not the screen: `pendingNotCounted`, `separateFromLeak`, `uncountedNotZero`. It must not be `homeVatHint` or `approvalsPendingExplain`.
- One concept means one key. Do not add `…Short` / `…Long` variants. A screen that needs only part of an idea either shows nothing visible (fold) or writes its own one-line visible status in its own namespace.
- A body may join one local key and one shared key: `` `${t('explain.creepCalc')} ${tx('separateFromLeak')}` `` (≤40 words in total).

### 3.3 How screens import
```ts
// client
import { explain } from '@/lib/i18n/messages/explain';
const tx = useT(explain);
<Explain line={…} body={tx('pendingNotCounted')} about={t('home.pending.about')} />

// server component
import { getT } from '@/lib/i18n/server';
const tx = await getT(explain);
<Explain line={…} body={tx('separateFromLeak')} about={…} />   // a client leaf inside a server page is fine
```
Never copy the text of an `explain` key into another namespace. The guard fails on exact duplicates (§5.3).

### 3.4 Rules for every `explain` body (enforced by §5.3)
- ≤40 words in total, ≤12 words per sentence. Plural imperative where it addresses the user ("בדקו"), matching the house style.
- **No ₪:** no `₪` character and no money placeholder (`amount`, `total`, `sum`, `price`, `value`, `ils`, `agorot`). The ₪ lives in the visible line, which is already role-gated. Every role can therefore render a shared body, including the receiver and the chef outside the orders screens.
- No role-specific wording, no "יעד", no retired term (מרכזת not "ריכוז", פער not "חריגה", דרישת זיכוי not "תביעה", קבלת סחורה, דליפה = the month's leak, "מחירים שעלו" = price creep).
- T4 concepts (pending, מרכזת, not counted) read calm and neutral: they say what happens next, never warn.

### 3.5 Receiver languages
`explain` is an overlaid namespace (`withReceiverLocales`). `explain.receiver.ts` carries `CompleteOverlays<Pick<typeof he, 'toggle'>>` for ar, ru, th and ti, plus any concept that a receiver screen actually renders. Such keys are machine-translated and marked pending native review, as W1-06 did. A concept missing from the overlay falls back to Hebrew, never English (`translate.ts:17-27`). W2-05 (owner of `receiverLangs/**`) reviews the overlay file.

### 3.6 Seed concepts (examples only; the six cut-lists own the full set)
| Key | Proposed he | Replaces today |
|---|---|---|
| `explain.pendingNotCounted` | "לרוב אלה חשבוניות מרכזות. עד השיוך הן לא נספרות בדליפה ובהוצאה." | tail of `overview/he.ts:51`; `approvals/he.ts:175` (also says "ריכוז"); `leaks/he.ts:81`; `leakProof/he.ts:18,39` (the proof page may render it open, §5.2 detail) |
| `explain.separateFromLeak` | "מדד נפרד. לא נספר בדליפה של החודש." | `overview/he.ts:177`; `leaks/he.ts:40`; tail of `leaks/he.ts:212` and `leaks/he.ts:33`: four wordings of one idea |
| `explain.uncountedNotZero` | "שורה ריקה היא \"לא נספר\", לא אפס. היא לא נכנסת לשווי." | `inventory/he.ts:43,64` (it would live in `inventory.explain` unless a second namespace needs it) |

### 3.7 Coordination with W2-13 (not a glossary design)
W2-13's brief has a `GLOSSARY` that "feeds 'מה זה?' popovers" (`docs/ux/wave2/W2-13.md:61`). To keep **one** pattern on working screens:
1. Any in-app "מה זה?" should render through `Explain` inline, not a popover.
2. When a glossary `define` and an `explain.<concept>` describe the same idea, one must point to the other, so the text is written once.

Both points are for the orchestrator to confirm with W2-13. Nothing here designs the glossary.

## 4. Copy rules for working screens (engineer view; Hebrew version in `RULES.he.md`)
| Rule | Concretely | Enforced by |
|---|---|---|
| One line per state | A status is one line: figure · status · (fold). | unit: a visible leaf is 1 sentence |
| Sentence ≤12 words | Count letter-led words; numbers and ₪ don't count. `—`, `;`, `.`, `!`, `?` end a sentence. | unit |
| No "why" on a working screen | Reasons go in a fold or are cut. `subtitle` lines under h1 are cut or move to `PageHeader explain`. | review; e2e: 0 unfolded blocks >12 words on phone task screens |
| Numbers before words | "3 חשבוניות ממתינות", "296 ₪ ממתינים להחלטה". | unit **warning**: a visible leaf with `{count}`/`{amount}`/`{n}`/`{total}` not in its first two tokens |
| Verbs on buttons | Plural imperative ("שלחו", "אשרו"). The fixed system nouns stay ("שמירה", "ביטול"). Never masculine singular. | W2-13 copy-gate (masculine singular); unit: button ≤4 words |
| Empty state = one line + one CTA | `EmptyState title` is the line; `description` only for `error`/`permission` (≤12 words). | review; optional type tightening in `EmptyState.tsx` (W2-15) |
| Info banners only for T2 | `Banner` for act-now items and live outcomes. No `tone="info"`/`"neutral"` banner carrying an explanation. | `ds-check.sh` ratchet line (W2-15, optional) |
| Longer than one sentence → folded | Unless it is legal or a confirmation. | unit (visible cap) + allowlist |
| Toast ≤8 words | Say what happened, not why. | unit (toast class) |
| Confirmations name ₪ and supplier | `ConfirmDialog` with `amount` + `party`; never folded, never cut. | review (binding rule) |
| Server notices and errors | `packages/api` returns a code plus vars, never prose for the UI. The UI maps them via `friendlyError` overrides / `serverErrors.ts` to a key of ≤12 words: what happened + what to do. | review; W2-13 gate scans server strings |

## 5. Measurement and guard

### 5.1 The word metric (one definition for auditors, budgets and tests)
- **Word** = a letter-led token, `/[A-Za-zא-ת][A-Za-zא-ת'"׳״\-]*/g`. This is the regex the copy auditors use (`work-A-owner-money/capture.cjs`). Numbers, ₪, `%`, dates and punctuation never count.
- **Screen copy words** = words of visible text nodes inside `main`, with the folds closed, he, on the demo seed (`reseed:demo --today 2026-10-25`). Excluded: `.sr-only`, `[aria-hidden="true"]`, `[hidden]`, `tbody`, `[data-record]` (data rows and cards, §5.5), and `[data-copy-exempt]` (legal blocks, printed letters/document previews, the money confirmation dialog body). The e2e seeds a fresh `worker_heartbeats` row, as `e2e/W1-05.spec.ts:41` does, so the stale-worker banner does not render.
- **First screen** = the words whose text box starts above `innerHeight` at load.
- **Reconcile with auditors:** they count `document.body.innerText`. That number ≈ ours + the chrome (≈66–69 words at desktop 1440, ≈10–12 on phone) + sr-only text + data rows. The e2e prints both so the numbers can be compared.

### 5.2 Budgets per screen type
"Today" was measured on the lab (`:3351`, build `ab9908c4`, he, 31.10) with this metric. Approval cards, pay-run rows and claim letters are not yet marked `data-record`, so they still count today.

| Type | Screens (examples) | Viewport | First screen ≤ | Whole page ≤ | Unfolded blocks >12 words | Today: first / page (blocks) |
|---|---|---|---|---|---|---|
| **Phone task** | receiver home, receiving list and `[poId]`, chef home, count, orders new/capture, manager approvals on the phone, supplier portal `/s/:token`, auth | 390×844 | **45** | **100** | **0** | receiver home 48/93 (1) · receiving 50/95 (1) · chef home 44/44 (0) · count 20/20 (1) · manager approvals 53/78 (0) · login 38 (page) |
| **Dashboard** | home, approvals, leaks, claims, suppliers, pay-run, bookkeeper home | 1440×900 (the same screen on the phone: first screen ≤60) | **150** | **260** | **≤1** (one T2 banner) | owner home 203/323 (4) · approvals 171/233 (0) · leaks 191/321 (2) · claims 135/684 (9, letters unmarked) · suppliers 91/180 (2) · bookkeeper home 180/236 (3) · pay-run 126/343 (2) · manager home on phone 66/266 (3) |
| **Detail** | invoice, supplier card, leak proof, report, settings, exports | 1440×900 | **110** | **320** | **≤3** | proof 81/254 (5) · settings 114/317 (4) · exports 126/126 (3) |

The owner home shows the gap is reachable. Folding the VAT card reason (≈30 words), folding the price-creep subtitle (12) and shortening the pending row (≈10) takes the first screen from 203 to ≈150. Not measured: chef `orders/new` (403 on the lab build; W1-11 lands it in train A) and `/s/:token` (the lab token had expired, 404).

### 5.3 Unit guard: `apps/web/lib/copy/__tests__/copy-budget.test.ts` (blocking; pure, <1 s, no DB)
It walks `ALL_NAMESPACES` (`lib/i18n/messages/index.ts:48`) and checks the **he** tree only (he is the source of truth; `i18n.test` already guards en parity). It reuses W2-13's walker if that has landed; otherwise `lib/copy/walk.ts` provides one for W2-13 to reuse.

Counting (`lib/copy/words.ts`):
1. ICU plurals → the longest branch.
2. Placeholders: number/₪/date vars (`count`, `n`, `amount`, `total`, `days`, `date`, `pct`, …) count 0. Text vars (`supplier`, `name`, `item`, `product`, `branch`, `restaurant`, `user`, `role`) count 1.
3. Words per the §5.1 regex.
4. Sentences: split on `.`, `!`, `?`, `;` and ` — `.

Classification (`lib/copy/classify.ts`, by namespace and key path):
| Class | Rule | Cap |
|---|---|---|
| exempt | namespaces `marketing`, `landing`, `showcase`, `growth`, `leakCheck`, `emails`; any path segment `legal`/`privacy`/`terms`/`cookies`/`accessibility` | none |
| explain | namespace `explain` (except `toggle.*`) or any segment `explain` | ≤40 words, ≤12/sentence, **no ₪ or money placeholder**, no "יעד" |
| button | segment `actions`; last segment `cta`, `*Cta`, `button`, `*Button`; `explain.toggle.*` | ≤4 |
| toast | any segment matching `/toast/i` | ≤8 |
| confirm | a segment starting with `confirm` and a last segment of title/body/message or `*Body`/`*Title` | ≤30; **warn** if a money namespace's confirm lacks an amount and a party placeholder |
| a11y | a segment `aria`/`sr`, or a last segment `*Aria`, `*AriaLabel`, `*Sr` | no cap (report >20; never force removal) |
| visible | everything else | ≤12 words **and** 1 sentence |

Fails when:
1. a non-allowlisted leaf exceeds its class cap;
2. an allowlisted leaf **grows** beyond its recorded count (the ratchet);
3. an `explain` leaf breaks §3.4;
4. two keys hold the **same text** (normalised: no punctuation or placeholders, ≥6 words) and neither is in `explain`. The message says "make it one `explain.<concept>` key".

Warns (one table, never fails):
- stale allowlist entries (the leaf is now under its cap; delete the entry);
- near-duplicates (token Jaccard ≥0.6, ≥8 words) as concept-merge candidates;
- numbers-before-words misses.

The allowlist (`lib/copy/budget.allow.ts`) is generated once by `pnpm --filter @restomatch/web copy:baseline` and then only shrinks:
```ts
export const COPY_ALLOW: Record<`${string}:${string}`, { words: number; reason: 'baseline' | 'legal' | 'confirmation' | 'a11y' | 'detail'; owner: string }> = {
  'receiving:inbox.emptyDescription': { words: 14, reason: 'baseline', owner: 'W2-05' },
  // …
};
```
Every `baseline` entry names the adopting package (§6.4). Adoption = deleting your entries.

### 5.4 e2e budget: `apps/web/e2e/W2-16.spec.ts` (check layer; non-blocking until gates flip in W4-01)
- `lib/copy/screens.ts` lists `{ id, route, role, vp, type, baseline: { first, page, blocks } }`, seeded from the §5.2 measurements.
- `e2e/helpers/copyBudget.ts` exports `measureCopy(page) → { first, page, blocks: {text, words}[], bodyWords }` (§5.1).
- For each screen it asserts `first ≤ baseline.first + 3` and `page ≤ baseline.page + 3` (the +3 absorbs relative-time strings). It prints the gap to the **type** budget. Every adopting PR lowers its baselines; when a baseline reaches the type budget, the entry switches to `type` and the ratchet becomes the budget.
- **Fold contract on every screen:** every `[data-explain-toggle]` loads with `aria-expanded="false"` and an `aria-controls` that points at a `hidden` element. Its box is ≥44×44 (≥48 inside `[data-mode=field]`). Clicking it reveals the panel and keeps focus on the toggle. The accessible names of the toggles on a page are unique. No toggle sits inside `dialog`, `[role=alert]`, `tbody` or `[data-copy-exempt]`.
- Run: `. ~/.rm-lab/w2_16/env && pnpm --filter @restomatch/web exec playwright test e2e/W2-16.spec.ts`. Lab port 3416 per the `lab.sh` rule.

### 5.5 Markers
- `data-record` goes on the root of each data row or card. W2-15 adds it once in `DataTable` rows and `MobileCardList` items. Owners add it to custom lists (approval cards, pay-run rows, claim letters) when they adopt.
- `data-copy-exempt` goes on legal blocks, printed letters/document previews and money confirmation bodies only. The e2e prints the exempt word count per screen so reviewers can spot abuse.

## 6. Rollout (no collision with W1-08 or other wave-2 packages)

### 6.1 Timeline
| When | What | Who |
|---|---|---|
| Sat 31.10 – Mon 2.11 | This spec, `RULES.he.md`, the six cut-lists. Each cut-list item is tagged **cut / shorten / share / fold**. | this workflow → orchestrator → owner |
| **Batch P**: closes Tue 3.11 20:00, rides **train B** (Wed 4.11 08:00) | **Values only**: shorten or cut existing keys on the pilot paths (receiver phone, chef, manager phone, owner home). It adds no keys, renames none, and brings no component, fold or namespace. | one Batch-P session |
| 4.11 / 6–10.11 freeze (README §12 dates win) | Nothing merges. W2-16 builds on its branch as a draft PR. | W2-16 |
| After 10.11, merge **step 2** (enablers) | **W2-16a, the mechanism:** `Explain` + `useDisclosure`, the `explain` namespace + receiver slice, `PageHeader explain` (via W2-15), the unit guard + baseline allowlist, the e2e helper + baseline. Exports are published in the first commit (README "day-1 rule"). | W2-16 |
| Steps 4–7 | **Each area package adopts on its own screens, in its own PR**: folds via `Explain`, shared concepts via `explain.*`, its allowlist entries deleted, its e2e baselines lowered. | §6.4 |
| Step 5 | **W2-16b:** adoption for in-scope areas with no wave-2 owner | W2-16 |
| Step 8 (W2-15 final PR) | The allowlist holds only `legal` / `confirmation` / `a11y` / `detail` entries for in-scope namespaces; the leftovers become W3 items. | orchestrator |
| W4-01 | The e2e budget becomes blocking, together with the other gate flips. | W4-01 |

### 6.2 Batch P rules (pilot-safe)
- **After W1-08.** The task puts W1-08's terminology sweep in train A (Tue 3.11); `pilot/PILOT-RUNBOOK.md:130` lists it in train B. Either way, Batch P branches from the head that already contains W1-08, or merges right after it inside train B. If both touch one key, W1-08's term wins and Batch P re-applies the shortening on top.
- **Not in another train package's catalog.** W1-08 holds `approvals`, `components`, `leakProof` and `consolidated` `he.ts`; S5 holds `suppliers/he.ts`; S2 holds `invoices/he.ts` (`pilot/SESSION-BRIEFS.md:6`). Value edits for those files go to that session as a list, or wait for wave 2.
- **Values, not keys.** The same rule as W2-13 §8. Change he and en together (`i18n.test` parity).
- **e2e text pins.** For every changed value, `grep -rn -F "<old fragment>" apps/web/e2e apps/web/**/__tests__`. Update your own specs, and list the others in the PR (wave 1 shipped 47 cross-package e2e breaks).
- **Receiver overlays.** Don't change a string that has ar/ru/th/ti overlays unless the overlays change in the same PR. Otherwise leave it for W2-05.
- **Binding rules hold** (legal, ₪ confirmations, a11y, T4 calm, terms, no "יעד", no ₪ for receiver/chef except chef orders).

### 6.3 W2-16a acceptance (short)
1. `Explain`, `ExplainToggle`, `ExplainPanel` and `useDisclosure` are exported from `lib/components`. `explain.test.tsx` is green. Axe shows 0 serious in he and en at 390 and 1440 on the lab demo page `app/dashboard/lab/**` (W2-15 lab), with the fold collapsed and expanded.
2. The `explain` namespace exists, with he/en parity and the receiver `toggle` overlay. It holds the 3 seed concepts plus the cut-list "share" items.
3. `copy-budget.test.ts` is green on main with the generated allowlist. Each rule has a fixture proven to fire (a 13-word visible string, a 9-word toast, ₪ in an explain body, an exact duplicate, a grown allowlisted string).
4. `W2-16.spec.ts` is green against the baselines and prints the type-budget gap table.
5. `PageHeader explain` lands via W2-15. Nothing in an immutable path changes.

### 6.4 Who adopts what (README §9 ownership)
| Area / screens | Adopts | Notes |
|---|---|---|
| home, LeakHero, nav | **W2-08** | Retire the LeakHero ⓘ `calcNote` popover (24 px, icon-only, overlay): use `Explain label="how"` or cut it, since the hero already links "איך חישבנו?" to the proof page. Owner home: fold the VAT card reason; `separateFromLeak` on the price-creep header; pending row → `pendingNotCounted`. |
| approvals | W2-04 | `approvals.why.*.explain` (12 discrepancy reasons, `approvals/he.ts:146-191`) are ideal fold bodies. `WhyLine` stays visible. |
| pay-run | W2-03 | — |
| invoices, inbox, scans, consolidated | W2-02 | T4 מרכזת wording stays neutral. |
| receiving (receiver phone), dockPrice, receiverLangs | W2-05 | Cut first; any fold needs overlays (§3.5). |
| orders (chef sees ₪ here only) | W2-06 | — |
| inventory / count | W2-07 | `uncountedNotZero` |
| leaks, proof, report, views | W2-09 | The proof page may render `explain` bodies open (detail type). |
| claims, recovery | W2-10 | Mark letters `data-copy-exempt` (document preview). |
| suppliers | W2-11 | — |
| contracts | W2-12 | — |
| settings, team, exports, integrations | W2-14 | — |
| supplier portal `/s/:token` | G-10 | phone task budget |
| error pages (`app/{error,global-error}.tsx`) | G-11 | — |
| ask | G-12 | — |
| `components`, `common` copy | W2-13 | No explanations are expected there. Toasts and errors follow §4. |
| **auth, onboarding, invite, admin pages (not `admin/layout.tsx`), recipes, catalog, products, chain, branches, reports** | **W2-16b** | These have no wave-2 owner in README §9. Each needs the orchestrator's OK as a boundary addition. |

Packages already running (batch A) get this as a one-message DoD addendum. Packages not yet started get it in their brief: "**DoD-6b copy focus:** your screens meet §5.2 or lower their ratchet; your `budget.allow.ts` entries are gone; shared ideas use `explain.*`; folds use `Explain`."

### 6.5 Collision rules for catalogs (all of wave 2)
1. Only the namespace owner edits its `he.ts`/`en.ts`. W2-16 edits only `messages/explain/**`.
2. A package that needs a new shared concept sends W2-16 one message with the proposed key and text (SLA one working day). Until it lands, the package uses a local `<ns>.explain.<concept>` key and switches it in one line later.
3. Fold adoption = **one shortened value** (the existing key) plus **one new `explain` key**. Delete orphaned keys in a later cleanup PR after the e2e grep, never in the same PR as another package's work.
4. The allowlist is a single file with one entry per key, sorted by key and grouped by owner comment. Two packages deleting different lines merge cleanly; the orchestrator rebases conflicts on `release/wave-2`.
5. W2-13's copy-gate (terms, masculine singular, "יעד") and this guard (length, duplicates) are separate tests over one shared walker. Neither duplicates the other's rules.

### 6.6 Requested path additions and exceptions (for the orchestrator)
- W2-15: new `lib/components/Explain.tsx` + its test, one barrel line, the `PageHeader` `explain` prop, `data-record` on `DataTable` rows and `MobileCardList` items, optionally a `ds-check.sh` line for `Banner tone="info|neutral"`.
- W2-13: one line in `messages/index.ts` registering `explain`, and agreement on the shared walker.
- W2-05: review of `explain.receiver.ts`.
- The W2-16b areas listed in §6.4.

## 7. Open questions (each is a small switch, not a redesign)
1. The train for the W1-08 sweep: A (Tue 3.11), as the task states, or B (Wed 4.11), as the runbook states? Batch P follows it either way (§6.2).
2. `explain` as its own namespace (recommended) or `common/explain.ts`? The content and API are the same.
3. Should W2-13's "מה זה?" render through `Explain` inline (recommended, one pattern, nothing covers the task)?
4. W2-16b's boundary for the unowned areas in §6.4.

## Appendix: lab evidence (`:3351`, he, 31.10)
- Screenshots: `shots/mech--<screen>--{desktop,phone}.jpg` (full page) and `…-top.jpg` (first screen) for owner home/approvals/leaks/proof/claims/suppliers/settings, bookkeeper home/pay-run/exports, manager home/approvals (phone), receiver home/receiving (phone), chef home/count (phone), login. Chef `orders/new` answered 403 (old build) and the portal token 404.
- Raw numbers: `work-mech/probe-results.json` (body/main words, `<summary>`/`aria-expanded` inventory with heights, banners, long blocks) and `work-mech/measure-results.json` (the §5.1 metric). Scripts: `work-mech/{probe,measure}.cjs`.
- Seen today: the icon-only LeakHero ⓘ summary measures 24 px on desktop. `ViewDisclosure` measures 44 px. Every dashboard page carries the stale-worker banner (17 words) in the lab. Price creep is explained in four wordings across home and leaks. The leaks page has 26 `title=` attributes (17 unique). Most are icon-button names and exact ₪ values. One carries price evidence ("חוזה 139.00 ₪, חויב 149.00 ₪"), which is invisible on touch: W2-09 should show it visibly, not in a fold (rule §2.7.6).
