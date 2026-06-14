'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  Bell,
  Check,
  ChevronDown,
  Clock,
  Hash,
  Lock,
  MessageSquare,
  Shield,
  User,
  Zap,
} from 'lucide-react';
import { useRef, useState } from 'react';

type SeverityTier = 'auto' | 'review-manager' | 'review-owner' | 'block' | 'hard-block';
type ApproverRole = 'auto' | 'clerk' | 'manager' | 'owner' | 'bookkeeper';
type Action = 'auto_approve' | 'queue_review' | 'hold_invoice' | 'whatsapp_alert' | 'hard_block';

interface Rule {
  id: string;
  type: string;
  description: string;
  approverRole: ApproverRole;
  action: Action;
  severity: SeverityTier;
  priority: number;
  matchesThisMonth: number;
  auditLog: AuditEntry[];
}

interface AuditEntry {
  timestamp: string;
  actor: string;
  actorRole: ApproverRole;
  decision: 'approved' | 'rejected' | 'escalated' | 'auto';
  amount: number;
  hash: string;
  note?: string;
}

const RULES: Rule[] = [
  {
    id: 'rule-100',
    type: 'חשבונית כפולה',
    description: 'אותו מספר חשבונית קיים כבר במערכת לאותו ספק',
    approverRole: 'bookkeeper',
    action: 'hard_block',
    severity: 'hard-block',
    priority: 100,
    matchesThisMonth: 3,
    auditLog: [
      {
        timestamp: '2026-05-21 09:35:12',
        actor: 'אוטומטי',
        actorRole: 'auto',
        decision: 'auto',
        amount: 3200,
        hash: '7f2a:9c4d:1e88:33bc',
        note: 'INV-4882 ‎(קצביית הכרם) זוהה כקיים מ-2026-05-12',
      },
      {
        timestamp: '2026-05-08 14:22:01',
        actor: 'אוטומטי',
        actorRole: 'auto',
        decision: 'auto',
        amount: 1840,
        hash: 'a44f:bb12:00de:5567',
      },
    ],
  },
  {
    id: 'rule-95',
    type: 'חשבונית > ₪5,000 ללא PO',
    description: 'חשבונית גדולה שלא נמצאה הזמנת רכש תואמת',
    approverRole: 'owner',
    action: 'hold_invoice',
    severity: 'block',
    priority: 95,
    matchesThisMonth: 1,
    auditLog: [
      {
        timestamp: '2026-05-19 11:42:08',
        actor: 'רומי קורן',
        actorRole: 'owner',
        decision: 'approved',
        amount: 6420,
        hash: '03ee:11ab:cc09:7d23',
        note: 'הסכמת ספק שזה משלוח חירום, אישור ידני',
      },
    ],
  },
  {
    id: 'rule-90',
    type: 'פריט שלא הוזמן (> ₪100)',
    description: 'שורה בחשבונית שאין לה PO line תואם, מעל ערך ₪100',
    approverRole: 'owner',
    action: 'whatsapp_alert',
    severity: 'block',
    priority: 90,
    matchesThisMonth: 4,
    auditLog: [
      {
        timestamp: '2026-05-20 08:15:55',
        actor: 'רומי קורן',
        actorRole: 'owner',
        decision: 'rejected',
        amount: 240,
        hash: 'd112:8901:4477:aa3c',
      },
      {
        timestamp: '2026-05-17 16:08:31',
        actor: 'רומי קורן',
        actorRole: 'owner',
        decision: 'approved',
        amount: 180,
        hash: '6c2b:1180:ff44:9001',
        note: 'מבצע לקראת חג',
      },
    ],
  },
  {
    id: 'rule-80',
    type: 'הפרש מחיר > 10%',
    description: 'מחיר חויב חרג מעל סף ה-block המוגדר',
    approverRole: 'owner',
    action: 'hold_invoice',
    severity: 'review-owner',
    priority: 80,
    matchesThisMonth: 8,
    auditLog: [
      {
        timestamp: '2026-05-21 09:14:02',
        actor: 'רומי קורן',
        actorRole: 'owner',
        decision: 'rejected',
        amount: 580,
        hash: '8a2f:3344:e0c1:7654',
        note: 'דרשנו הסבר מאבי הירקן',
      },
    ],
  },
  {
    id: 'rule-60',
    type: 'הפרש מחיר 2-5%',
    description: 'חריגה בינונית — דרושה סקירה של מנהל משמרת',
    approverRole: 'manager',
    action: 'queue_review',
    severity: 'review-manager',
    priority: 60,
    matchesThisMonth: 23,
    auditLog: [
      {
        timestamp: '2026-05-21 07:48:19',
        actor: 'שיינוס לוי',
        actorRole: 'manager',
        decision: 'approved',
        amount: 45,
        hash: 'fb01:2200:cdef:0099',
      },
    ],
  },
  {
    id: 'rule-10',
    type: 'הפרשים < 2%',
    description: 'תנודה זניחה — אישור אוטומטי, רישום בלבד',
    approverRole: 'auto',
    action: 'auto_approve',
    severity: 'auto',
    priority: 10,
    matchesThisMonth: 187,
    auditLog: [
      {
        timestamp: '2026-05-21 09:28:00',
        actor: 'אוטומטי',
        actorRole: 'auto',
        decision: 'auto',
        amount: 8,
        hash: '1234:5678:9abc:def0',
      },
    ],
  },
];

export default function ApprovalsShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from('.rule-row', {
        y: 16,
        opacity: 0,
        stagger: 0.06,
        duration: 0.5,
        ease: 'power2.out',
      });
    },
    { scope: containerRef },
  );

  return (
    <main ref={containerRef} className="max-w-6xl mx-auto px-6 py-12" dir="rtl">
      <div className="mb-10">
        <div className="mb-2 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold mb-2">
          Decision Hierarchy
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight mb-2 text-ink">מטריצת אישורים</h1>
        <p className="text-muted max-w-2xl">
          הגדרת ניתוב לפי תפקיד וסוג חריגה. כל שורה ניתנת להרחבה לתצוגת ה-audit log
          האימוטבילי — כל החלטה היסטורית עם hash קריפטוגרפי לתיעוד tamper-proof.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-card">
        <div className="grid grid-cols-[40px_1fr_140px_160px_120px_60px] gap-4 px-5 py-3 border-b border-line text-xs uppercase tracking-wider text-subtle font-semibold bg-surface-2">
          <div>#</div>
          <div>סוג חריגה</div>
          <div>תפקיד מאשר</div>
          <div>פעולה אוטומטית</div>
          <div className="text-center">החודש</div>
          <div />
        </div>

        {RULES.map((rule, idx) => (
          <RuleRow key={rule.id} rule={rule} idx={idx} />
        ))}
      </div>

      <div className="mt-6 text-xs text-muted flex items-center gap-4 flex-wrap">
        <LegendSwatch tone="auto" label="אוטומטי" />
        <LegendSwatch tone="review-manager" label="סקירת מנהל" />
        <LegendSwatch tone="review-owner" label="סקירת בעלים" />
        <LegendSwatch tone="block" label="חוסם תשלום" />
        <LegendSwatch tone="hard-block" label="חסימה מיידית" />
      </div>
    </main>
  );
}

function RuleRow({ rule, idx }: { rule: Rule; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const expandRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!expandRef.current) return;
      if (expanded) {
        gsap.fromTo(
          expandRef.current,
          { height: 0, opacity: 0 },
          { height: 'auto', opacity: 1, duration: 0.4, ease: 'power2.out' },
        );
      } else {
        gsap.to(expandRef.current, {
          height: 0,
          opacity: 0,
          duration: 0.25,
          ease: 'power2.in',
        });
      }
    },
    { dependencies: [expanded] },
  );

  const toneStyles: Record<SeverityTier, string> = {
    auto: 'hover:bg-surface-2 border-r-primary/50',
    'review-manager': 'hover:bg-surface-2 border-r-info/50',
    'review-owner': 'hover:bg-surface-2 border-r-warn/60',
    block: 'hover:bg-surface-2 border-r-warn',
    'hard-block': 'hover:bg-surface-2 border-r-danger',
  };

  return (
    <div
      className={`rule-row border-b border-line last:border-b-0 border-r-2 ${toneStyles[rule.severity]}`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full grid grid-cols-[40px_1fr_140px_160px_120px_60px] gap-4 px-5 py-4 items-center text-right transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
      >
        <div className="text-xs text-subtle font-mono tabular-nums font-bold">
          {String(idx + 1).padStart(2, '0')}
        </div>

        <div>
          <div className="font-semibold text-sm flex items-center gap-2 text-ink">
            {rule.severity === 'hard-block' ? (
              <Lock className="w-3.5 h-3.5 text-danger" />
            ) : null}
            {rule.type}
          </div>
          <div className="text-xs text-muted mt-0.5">{rule.description}</div>
        </div>

        <RoleBadge role={rule.approverRole} />
        <ActionBadge action={rule.action} />

        <div className="text-center">
          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-surface-2 border border-line text-xs font-bold font-mono tabular-nums text-ink">
            {rule.matchesThisMonth.toLocaleString('he-IL')}
          </span>
        </div>

        <div className="flex justify-end">
          <ChevronDown
            className={`w-4 h-4 text-subtle transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      <div ref={expandRef} style={{ height: 0, opacity: 0, overflow: 'hidden' }}>
        <AuditLog entries={rule.auditLog} />
      </div>
    </div>
  );
}

function AuditLog({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="bg-surface-2 border-t border-line px-5 py-5">
      <div className="flex items-center gap-2 mb-4 text-xs text-muted">
        <Lock className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold text-ink">Immutable Audit Log</span>
        <span className="text-subtle">·</span>
        <span>{entries.length} רישומים · SHA-256 hash chain</span>
      </div>

      <div className="space-y-2">
        {entries.map((entry, i) => (
          <AuditEntryRow key={i} entry={entry} />
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-dashed border-line flex items-center justify-between text-[10px] text-subtle">
        <span>* כל החלטה חתומה ב-hash שמתבסס על ההחלטה הקודמת — כל שינוי רטרואקטיבי נחשף.</span>
        <span className="font-mono tabular-nums text-primary">verified ✓</span>
      </div>
    </div>
  );
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const decisionColors = {
    approved: 'text-primary bg-primary/12 ring-1 ring-primary/25',
    rejected: 'text-danger bg-danger/12 ring-1 ring-danger/25',
    escalated: 'text-warn bg-warn/12 ring-1 ring-warn/25',
    auto: 'text-info bg-info/12 ring-1 ring-info/25',
  } as const;

  const decisionLabel = {
    approved: 'אושר',
    rejected: 'נדחה',
    escalated: 'עלה דרגה',
    auto: 'אוטומטי',
  };

  return (
    <div className="grid grid-cols-[140px_1fr_120px_100px_140px] gap-3 items-center text-xs py-2 px-3 rounded-lg bg-surface border border-line">
      <div className="flex items-center gap-1.5 text-muted font-mono tabular-nums">
        <Clock className="w-3 h-3" />
        {entry.timestamp}
      </div>
      <div>
        <div className="flex items-center gap-2 text-ink">
          <User className="w-3 h-3 text-subtle" />
          <span className="font-medium">{entry.actor}</span>
          <RoleBadge role={entry.actorRole} small />
        </div>
        {entry.note ? <div className="text-[11px] text-muted mt-0.5">{entry.note}</div> : null}
      </div>
      <div>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${decisionColors[entry.decision]}`}
        >
          {decisionLabel[entry.decision]}
        </span>
      </div>
      <div className="font-bold font-mono tabular-nums text-ink">
        ₪{entry.amount.toLocaleString('he-IL')}
      </div>
      <div
        className="flex items-center gap-1.5 text-muted font-mono text-[10px] tabular-nums"
        title={entry.hash}
      >
        <Hash className="w-3 h-3" />
        <span className="truncate">{entry.hash}</span>
      </div>
    </div>
  );
}

function RoleBadge({ role, small }: { role: ApproverRole; small?: boolean }) {
  const map: Record<ApproverRole, { label: string; icon: React.ReactNode; tint: string }> = {
    auto: {
      label: 'אוטומטי',
      icon: <Zap className="w-3 h-3" />,
      tint: 'text-muted bg-surface-2 ring-1 ring-line',
    },
    clerk: {
      label: 'מקבל',
      icon: <User className="w-3 h-3" />,
      tint: 'text-muted bg-surface-2 ring-1 ring-line',
    },
    manager: {
      label: 'מנהל',
      icon: <Shield className="w-3 h-3" />,
      tint: 'text-info bg-info/12 ring-1 ring-info/25',
    },
    owner: {
      label: 'בעלים',
      icon: <Shield className="w-3 h-3" />,
      tint: 'text-gold bg-gold/12 ring-1 ring-gold/25',
    },
    bookkeeper: {
      label: 'חשב',
      icon: <Shield className="w-3 h-3" />,
      tint: 'text-primary bg-primary/12 ring-1 ring-primary/25',
    },
  };
  const { label, icon, tint } = map[role];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold ${tint} ${
        small ? 'text-[10px] py-0.5' : ''
      }`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

function ActionBadge({ action }: { action: Action }) {
  const map: Record<Action, { label: string; icon: React.ReactNode; tint: string }> = {
    auto_approve: {
      label: 'אישור אוטומטי',
      icon: <Check className="w-3 h-3" />,
      tint: 'text-primary bg-primary/12 ring-1 ring-primary/25',
    },
    queue_review: {
      label: 'תור סקירה',
      icon: <Clock className="w-3 h-3" />,
      tint: 'text-info bg-info/12 ring-1 ring-info/25',
    },
    hold_invoice: {
      label: 'חוסם תשלום',
      icon: <Lock className="w-3 h-3" />,
      tint: 'text-warn bg-warn/12 ring-1 ring-warn/25',
    },
    whatsapp_alert: {
      label: 'התראת ווטסאפ',
      icon: <MessageSquare className="w-3 h-3" />,
      tint: 'text-primary bg-primary/12 ring-1 ring-primary/25',
    },
    hard_block: {
      label: 'חסימה מיידית',
      icon: <Bell className="w-3 h-3" />,
      tint: 'text-danger bg-danger/12 ring-1 ring-danger/25',
    },
  };
  const { label, icon, tint } = map[action];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${tint}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

function LegendSwatch({ tone, label }: { tone: SeverityTier; label: string }) {
  const colors: Record<SeverityTier, string> = {
    auto: 'bg-primary/60 ring-1 ring-primary/40',
    'review-manager': 'bg-info/60 ring-1 ring-info/40',
    'review-owner': 'bg-warn/60 ring-1 ring-warn/40',
    block: 'bg-warn ring-1 ring-warn/50',
    'hard-block': 'bg-danger ring-1 ring-danger/50',
  };
  return (
    <div className="flex items-center gap-2">
      <span className={`w-3 h-3 rounded-sm ${colors[tone]}`} />
      <span>{label}</span>
    </div>
  );
}
