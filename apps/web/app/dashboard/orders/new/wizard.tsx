'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  History,
  Plus,
  Repeat,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { UnitText } from '@/lib/components/UnitText';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Select,
  Spinner,
  cn,
  displayName,
  entitlementCauseOf,
  friendlyError,
  trpcErrorCode,
  useSingleFlight,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { formatIls } from '@/lib/money';
import { OrderDocumentPreview } from '../order-document-preview';
import {
  addOrMerge,
  lineTotalIls,
  ltrIsolate,
  linesValid,
  orderTotalIls,
  poRefOf,
  reorderLines,
  unpricedCount,
  waLink,
} from '../order-logic';
import { DecimalInput } from '../decimal-input';
import { FieldMode } from '../field-mode';
import { UNDO_MS, UndoCountdown } from '../undo-bar';
import { InlineDocument } from '../supplier-document';
import { openWhatsappNow } from '../w2-logic';
import { GuidePanel } from './steps/guide-panel';
import { SupplierBoard } from './steps/supplier-board';
import { OverContractNote, useOrderContractPrices } from './contract-price';
import { addDays, localNow, nextDeliveryOptions, type DeliveryOption } from './delivery-days';
import {
  emptyCart,
  loadStore,
  pairServerLines,
  saveStore,
  withCart,
  type Cart,
  type CartLine,
  type CartStore,
  type ServerLine,
} from './draft-store';

type Outputs = inferRouterOutputs<AppRouter>;
/** 'manual' = "מהוואטסאפ שלי": the user sends from their own WhatsApp; we record it (W2-06 §5.3). */
type Channel = 'email' | 'whatsapp' | 'none' | 'manual';
type DeliveryPreview = Outputs['orders']['previewDelivery'];
type Supplier = Outputs['suppliers']['list'][number];
type PoLine = Outputs['orders']['get']['lines'][number];

type Step = 'SUPPLIER' | 'BUILD' | 'REVIEW' | 'SENT';
const STEP_NO: Record<Step, number> = { SUPPLIER: 1, BUILD: 2, REVIEW: 3, SENT: 3 };
const TZ = 'Asia/Jerusalem';

const fwd = 'h-4 w-4 rtl:-scale-x-100';
const newKey = () => crypto.randomUUID();

/**
 * Keep the address bar on the order being built (a reload or a shared link lands on
 * the same supplier) without a navigation: the wizard's state stays mounted.
 */
function setUrl(supplierId: string) {
  try {
    window.history.replaceState(
      window.history.state,
      '',
      supplierId ? `/dashboard/orders/new?supplierId=${encodeURIComponent(supplierId)}` : '/dashboard/orders/new',
    );
  } catch {
    // Non-fatal: the cart is saved on the device either way.
  }
}

const toServerLine = (l: PoLine): ServerLine => ({
  id: l.id,
  productId: l.productId,
  rawDescription: l.rawDescription,
  qty: Number(l.qtyOrdered),
  unit: l.unit,
  unitPriceExpected: l.unitPriceExpected == null ? null : Number(l.unitPriceExpected),
});

const cartLineOf = (l: PoLine): CartLine => ({
  key: newKey(),
  productId: l.productId ?? undefined,
  rawDescription: l.rawDescription ?? '',
  nameEn: l.productNameEn,
  qty: Number(l.qtyOrdered),
  unit: l.unit,
  unitPriceExpected: l.unitPriceExpected == null ? undefined : Number(l.unitPriceExpected),
});

/** The restaurant-local day of a stored delivery instant ('' when none). */
const dayKeyOf = (at: Date | string | null | undefined) => (at ? localNow(new Date(at), TZ).date : '');

/** The device cart's server draft was sent or cancelled somewhere else. */
class StaleDraftError extends Error {
  constructor(
    readonly poId: string,
    readonly status: string,
  ) {
    super('stale draft');
  }
}

interface PendingReorder {
  supplierId: string;
  lines: CartLine[];
  /** The draft already there for this supplier: this device's cart, or a server draft. */
  existing: { kind: 'local'; cart: Cart } | { kind: 'server'; draftId: string; count: number };
}

export function NewOrderWizard({
  initialSupplierId,
  fromPoId,
  restaurantId,
}: {
  initialSupplierId: string;
  /** "Order again": prefill from this PO. */
  fromPoId?: string;
  /** Scopes this device's saved carts to the branch. */
  restaurantId: string;
}) {
  const t = useT(ordersNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<Step>(initialSupplierId || fromPoId ? 'BUILD' : 'SUPPLIER');
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  /** The day the manager picked ('' = the server's default for this supplier). */
  const [deliveryDate, setDeliveryDate] = useState('');
  /** The server draft this order is saved as, and its lines as saved. */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [server, setServerState] = useState<Cart['server']>(null);
  /** Mirrors `server` for async code that must see the latest snapshot mid-handler. */
  const serverRef = useRef<Cart['server']>(null);
  const setServer = useCallback((v: Cart['server']) => {
    serverRef.current = v;
    setServerState(v);
  }, []);
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [announce, setAnnounce] = useState('');

  /** This device's carts, loaded after mount (never during SSR). */
  const store = useRef<CartStore>({ activeSupplierId: null, carts: {} });
  const [hydrated, setHydrated] = useState(false);
  const [resumeOffer, setResumeOffer] = useState<{ supplierId: string; count: number } | null>(null);
  const [restoredNote, setRestoredNote] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [switchUndo, setSwitchUndo] = useState<{ from: string; to: string; fromStep: Step; count: number; deadline: number } | null>(null);
  const [pendingReorder, setPendingReorder] = useState<PendingReorder | null>(null);
  const [reorderInfo, setReorderInfo] = useState<{ ref: string; unavailable: string[]; count: number } | null>(null);
  const [reorderDone, setReorderDone] = useState(!fromPoId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [sending, setSending] = useState<{ poId: string; deadline: number } | null>(null);
  const [sent, setSent] = useState<{ poId: string; channel: Channel; supplier: string; day: string } | null>(null);
  /** Bumped after every server sync so the literal document re-renders from the saved draft. */
  const [docVersion, setDocVersion] = useState(0);
  /** The server draft's version (xmin) as last saved — sent with every save (W2-06 §5.7). */
  const versionRef = useRef<string | null>(null);
  const [serverSave, setServerSave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  /** "מהוואטסאפ שלי": the exact text, fetched on that explicit choice, kept in memory for the tap. */
  const [manual, setManual] = useState<{ poId: string; text: string; to: string | null } | null>(null);
  /** A device cart dropped because its draft was sent / cancelled elsewhere. */
  const [stale, setStale] = useState<{ supplierId: string; poId: string; status: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(rawSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  const suppliers = trpc.suppliers.list.useQuery({});
  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  const nameOf = useCallback(
    (s: Pick<Supplier, 'name' | 'nameEn'> | undefined) => (s ? displayName(s.name, s.nameEn, locale).primary : ''),
    [locale],
  );
  const supplierLabel = nameOf(supplier);

  // ── This device's carts: load once, restore the one for a pre-picked supplier,
  //    otherwise offer the last unsent one ("המשך מהטיוטה (7 פריטים)").
  //    A cart whose server draft is no longer a draft (sent / cancelled on another
  //    screen or device) is dropped first — never offered, never sent twice.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let s = loadStore(restaurantId);
      const saved = Object.entries(s.carts).filter(([, c]) => c.draftId);
      const checks = await Promise.all(
        saved.map(async ([sid, c]) => {
          try {
            const d = await utils.orders.get.fetch({ poId: c.draftId! });
            return { sid, poId: c.draftId!, status: d.po?.status ?? null };
          } catch (e) {
            // Gone → drop quietly; unreachable → keep (the send re-checks it).
            return { sid, poId: c.draftId!, status: trpcErrorCode(e) === 'NOT_FOUND' ? null : 'unknown' };
          }
        }),
      );
      if (cancelled) return;
      let staleFound: { supplierId: string; poId: string; status: string } | null = null;
      for (const ch of checks) {
        if (ch.status === 'draft' || ch.status === 'unknown') continue;
        s = withCart(s, ch.sid, null);
        if (ch.status && (!staleFound || ch.sid === initialSupplierId || ch.sid === s.activeSupplierId)) {
          staleFound = { supplierId: ch.sid, poId: ch.poId, status: ch.status };
        }
      }
      if (checks.length > 0) saveStore(restaurantId, s);
      store.current = s;
      if (staleFound) setStale(staleFound);
      if (!fromPoId && initialSupplierId && s.carts[initialSupplierId]) {
        const c = s.carts[initialSupplierId]!;
        applyCart(c);
        if (c.lines.length > 0) setRestoredNote(c.lines.length);
      } else if (!fromPoId && initialSupplierId) {
        // Another browser or device: the server draft is the source (W2-06 §5.7).
        const restored = await restoreServerDraft(initialSupplierId);
        if (cancelled) return;
        if (restored > 0) setRestoredNote(restored);
      } else if (!fromPoId && !initialSupplierId && s.activeSupplierId && s.carts[s.activeSupplierId]?.lines.length) {
        setResumeOffer({ supplierId: s.activeSupplierId, count: s.carts[s.activeSupplierId]!.lines.length });
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyCart(c: Cart) {
    setLines(c.lines);
    setDeliveryDate(c.deliveryDate);
    setChannel(c.channel);
    setDraftId(c.draftId);
    setServer(c.server);
    versionRef.current = null;
    setManual(null);
  }

  /** Load this user's open server draft for a supplier into the cart; returns its line count. */
  async function restoreServerDraft(id: string): Promise<number> {
    const d = await utils.orders.openDraft.fetch({ supplierId: id }).catch(() => null);
    if (!d || d.lines.length === 0) return 0;
    applyCart({
      ...emptyCart(),
      lines: d.lines.map((l) => ({
        key: newKey(),
        productId: l.productId ?? undefined,
        rawDescription: l.rawDescription ?? '',
        qty: l.qty,
        unit: l.unit,
        unitPriceExpected: l.unitPriceExpected ?? undefined,
      })),
      deliveryDate: dayKeyOf(d.expectedDeliveryAt),
      draftId: d.draftId,
    });
    versionRef.current = d.version;
    return d.lines.length;
  }

  // Every change is saved on the device (one cart per supplier). Not while "order
  //    again" is still deciding: the screen's empty cart then is not the supplier's
  //    cart, and saving it would erase the unsent one the choice card protects.
  const reorderOpen = !!fromPoId && (!reorderDone || !!pendingReorder);
  useEffect(() => {
    if (!hydrated || !supplierId || step === 'SENT' || reorderOpen) return;
    const cart: Cart = { lines, deliveryDate, channel, draftId, server, updatedAt: Date.now() };
    store.current = { ...withCart(store.current, supplierId, cart), activeSupplierId: supplierId };
    saveStore(restaurantId, store.current);
  }, [hydrated, supplierId, lines, deliveryDate, channel, draftId, server, step, restaurantId, reorderOpen]);

  // An unknown/foreign ?supplierId= falls back to the picker instead of a dead end.
  useEffect(() => {
    if (suppliers.data && supplierId && !supplier && !fromPoId) {
      setSupplierId('');
      setStep('SUPPLIER');
    }
  }, [suppliers.data, supplierId, supplier, fromPoId]);

  // ── Each step change moves focus to the step's heading (announced with "שלב 2
  //    מתוך 3") and scrolls to the top — never mid-page, never silent (a11y-06).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }, [step]);

  // ── Leave guard: an unsent order with lines asks before the page goes away. It is
  //    saved either way; this only stops a stray tap from walking off mid-order.
  const rootRef = useRef<HTMLDivElement>(null);
  const dirty = hydrated && lines.length > 0 && step !== 'SENT';
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || rootRef.current?.contains(a)) return;
      if (!window.confirm(t('draft.leaveConfirm'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, t]);

  const catalog = trpc.catalog.items.useQuery(
    { supplierId, search: search || undefined, limit: search ? 20 : 8 },
    { enabled: step === 'BUILD' && !!supplierId, placeholderData: (prev) => prev },
  );
  // Flag `contracts`: contract prices for what's on screen (no-op when off).
  const contractPrice = useOrderContractPrices(supplierId, [...(catalog.data ?? []), ...lines]);

  // Cadence: the server's default day (schedule-derived, else tomorrow) + chips for the next 3.
  const delivery = trpc.orders.previewDelivery.useQuery({ supplierId }, { enabled: !!supplierId, retry: false });
  const deliveryDay = deliveryDate || delivery.data?.defaultDate || '';
  const options = useMemo<DeliveryOption[]>(() => {
    const windows = supplier?.orderSchedule?.windows ?? null;
    return nextDeliveryOptions(windows, new Date(), supplier?.orderSchedule?.tz ?? TZ, 3);
  }, [supplier?.orderSchedule]);

  const docSettings = trpc.orders.documentSettings.useQuery(undefined, { retry: false });
  const pricedDoc = docSettings.data?.enabled === true;

  // Default channel follows what the supplier can actually receive.
  // Without the platform WhatsApp (plan-gated until H-05), "מהוואטסאפ שלי" is the WhatsApp default (§5.3).
  const board = trpc.orders.supplierBoard.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const platformWhatsapp = (board.data as { platformWhatsapp?: boolean } | undefined)?.platformWhatsapp === true;
  const defaultChannel: Channel = supplier?.contactEmail
    ? 'email'
    : supplier?.contactWhatsapp
      ? platformWhatsapp
        ? 'whatsapp'
        : 'manual'
      : 'none';
  const effectiveChannel = channel ?? defaultChannel;

  const total = useMemo(() => orderTotalIls(lines), [lines]);
  const unpriced = unpricedCount(lines);
  const valid = linesValid(lines);
  const pricedLines = useMemo(
    () =>
      lines
        .filter((l) => l.productId && typeof l.unitPriceExpected === 'number')
        .map((l) => ({ productId: l.productId!, unitPriceExpected: l.unitPriceExpected! })),
    [lines],
  );

  const guardrail = trpc.orders.guardrail.useQuery(
    { supplierId, lines: pricedLines },
    { enabled: step === 'REVIEW' && pricedLines.length > 0, retry: false },
  );
  const guardrailGated = guardrail.error ? !!entitlementCauseOf(guardrail.error) : false;
  const warningsByProduct = new Map((guardrail.data?.warnings ?? []).map((w) => [w.productId, w]));

  const createDraft = trpc.orders.createDraft.useMutation();
  const saveDraftM = trpc.orders.saveDraft.useMutation();
  const markManual = trpc.orders.markSentManually.useMutation();
  const placeOrder = trpc.orders.placeOrder.useMutation();
  const once = useSingleFlight();

  // ── "Order again" (?from=<poId>): today's prices, free lines verbatim, the
  //    supplier's dropped items named, the next valid day — then attach/replace
  //    if a draft for this supplier already exists.
  const fromQ = trpc.orders.get.useQuery({ poId: fromPoId ?? '' }, { enabled: !!fromPoId, retry: false });
  const fromSupplierId = fromQ.data?.po?.supplierId ?? '';
  const fullCatalog = trpc.catalog.items.useQuery(
    { supplierId: fromSupplierId, limit: 200 },
    { enabled: !!fromSupplierId && !reorderDone },
  );
  const reorderItems = useMemo(() => {
    const m = new Map<string, { productId: string; unit: string }>();
    for (const l of fromQ.data?.lines ?? []) if (l.productId) m.set(`${l.productId}|${l.unit}`, { productId: l.productId, unit: l.unit });
    return [...m.values()].slice(0, 500);
  }, [fromQ.data]);
  const reorderContracts = trpc.contracts.orderPrices.useQuery(
    { supplierId: fromSupplierId, items: reorderItems },
    { enabled: !!fromSupplierId && reorderItems.length > 0 && !reorderDone, retry: false },
  );
  const serverDrafts = trpc.orders.list.useQuery(
    { status: 'draft', supplierId: fromSupplierId || undefined, limit: 1 },
    { enabled: !!fromSupplierId && !reorderDone },
  );

  useEffect(() => {
    if (reorderDone || !hydrated || !fromPoId) return;
    if (fromQ.isError) {
      setReorderDone(true);
      toast.error(t('reorder.failed'));
      if (!initialSupplierId) setStep('SUPPLIER');
      return;
    }
    const po = fromQ.data?.po;
    if (!po || fullCatalog.isLoading || serverDrafts.isLoading) return;
    if (reorderItems.length > 0 && reorderContracts.isLoading) return;
    const contracts = new Map(
      (reorderContracts.data?.enabled ? reorderContracts.data.prices : []).map((p) => [`${p.productId}|${p.unit}`, p.contractPrice]),
    );
    const catalogRows = fullCatalog.data ?? [];
    const r = reorderLines(
      fromQ.data!.lines,
      catalogRows,
      (productId, unit) => contracts.get(`${productId}|${unit}`),
      catalogRows.length < 200,
    );
    const nameEn = new Map(fromQ.data!.lines.map((l) => [l.productId, l.productNameEn]));
    const prepared: CartLine[] = r.lines.map((l) => ({
      key: newKey(),
      productId: l.productId,
      rawDescription: l.rawDescription,
      nameEn: l.productId ? (nameEn.get(l.productId) ?? null) : null,
      qty: l.qty,
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected,
      priceSource: l.priceSource,
    }));
    setReorderDone(true);
    setSupplierId(po.supplierId);
    setReorderInfo({ ref: poRefOf(po.id), unavailable: r.unavailable, count: prepared.length });
    const local = store.current.carts[po.supplierId];
    const remote = serverDrafts.data?.find((d) => d.id !== po.id);
    if (local && local.lines.length > 0) {
      setPendingReorder({ supplierId: po.supplierId, lines: prepared, existing: { kind: 'local', cart: local } });
    } else if (remote) {
      setPendingReorder({
        supplierId: po.supplierId,
        lines: prepared,
        existing: { kind: 'server', draftId: remote.id, count: Number(remote.lineCount) },
      });
    } else {
      applyCart({ ...emptyCart(), lines: prepared });
      setStep('BUILD');
      setUrl(po.supplierId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reorderDone,
    hydrated,
    fromPoId,
    fromQ.data,
    fromQ.isError,
    fullCatalog.isLoading,
    fullCatalog.data,
    serverDrafts.isLoading,
    serverDrafts.data,
    reorderContracts.isLoading,
    reorderContracts.data,
    reorderItems.length,
  ]);

  async function resolveReorder(mode: 'attach' | 'replace' | 'keep') {
    const p = pendingReorder;
    if (!p) return;
    if (mode === 'keep') {
      // Keep my draft: the existing cart exactly as it was; the old order is not added.
      if (p.existing.kind === 'local') applyCart(p.existing.cart);
      setReorderInfo(null);
      setPendingReorder(null);
      if (p.existing.kind === 'server') {
        // The unsent draft lives on its own page; leave the wizard's cart empty.
        applyCart(emptyCart());
      }
      setStep('BUILD');
      setUrl(p.supplierId);
      return;
    }
    let base: Cart;
    if (p.existing.kind === 'local') {
      base = p.existing.cart;
    } else {
      // The server draft becomes this cart's draft: the first save brings it in
      // line (a fresh draft replaces it when lines were added).
      const d = await utils.orders.get.fetch({ poId: p.existing.draftId }).catch(() => null);
      const rows = d?.lines ?? [];
      const own = rows.map(cartLineOf);
      const paired = pairServerLines(own, rows.map(toServerLine));
      const isDraft = d?.po?.status === 'draft';
      // The screen shows the day the draft is saved for (not a fresh default).
      const day = isDraft ? dayKeyOf(d?.po?.expectedDeliveryAt) : '';
      base = {
        ...emptyCart(),
        lines: own,
        deliveryDate: day,
        draftId: isDraft ? p.existing.draftId : null,
        server: isDraft ? { deliveryDate: day, lines: paired } : null,
      };
    }
    let next = mode === 'replace' ? [] : base.lines;
    for (const l of p.lines) next = addOrMerge(next, l, newKey).lines;
    applyCart({ ...base, lines: next });
    setPendingReorder(null);
    setStep('BUILD');
    setUrl(p.supplierId);
  }

  // ── Supplier choice. Each supplier keeps its own cart; switching never deletes.
  function selectSupplier(id: string, nextStep: Step = 'BUILD') {
    const c = store.current.carts[id];
    if (c) applyCart(c);
    else {
      applyCart(emptyCart());
      // A supplier switch keeps both drafts; the other one comes back from the server.
      void restoreServerDraft(id).then((n) => n > 0 && setRestoredNote(n));
    }
    setSupplierId(id);
    setRawSearch('');
    setStep(nextStep);
    setResumeOffer(null);
    setRestoredNote(null);
    setSaveError(null);
    setUrl(id);
  }

  function switchSupplier(to: string) {
    setPickerOpen(false);
    if (to === supplierId) return;
    if (lines.length > 0 && supplierId) {
      setSwitchUndo({ from: supplierId, to, fromStep: step, count: lines.length, deadline: Date.now() + UNDO_MS });
    }
    selectSupplier(to, 'BUILD');
  }

  function discardDraft(id: string) {
    store.current = withCart(store.current, id, null);
    saveStore(restaurantId, store.current);
    if (id === supplierId) applyCart(emptyCart());
    setResumeOffer(null);
    setRestoredNote(null);
    toast.success(t('draft.discarded'));
  }

  function addLine(line: Omit<CartLine, 'key'>) {
    const res = addOrMerge(lines, line, newKey);
    setLines(res.lines);
    const name = displayName(line.rawDescription, line.nameEn, locale).primary;
    setAnnounce(res.merged ? t('wizard.alreadyAdded', { name }) : t('wizard.added', { name }));
  }
  function patchLine(key: string, patch: Partial<CartLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  // ── The server draft. Created when the order reaches review (so the supplier's
  //    literal document can be shown) and brought in line before sending.
  async function readBack(poId: string, cartLines: CartLine[]) {
    const d = await utils.orders.get.fetch({ poId });
    const paired = pairServerLines(cartLines, d.lines.map(toServerLine));
    // The day as the server saved it (it re-derives a scheduled supplier's default).
    setServer({ deliveryDate: dayKeyOf(d.po?.expectedDeliveryAt), lines: paired });
    // Prices the server filled in (catalog / contract) show on the review.
    setLines((ls) =>
      ls.map((l) => {
        const s = paired[l.key];
        return l.unitPriceExpected == null && s?.unitPriceExpected != null ? { ...l, unitPriceExpected: s.unitPriceExpected } : l;
      }),
    );
    setDocVersion((v) => v + 1);
  }

  /** Lines the server can hold: a description (or product) and a qty. Empty-qty lines stay on the device. */
  const savableLines = (ls: CartLine[]) =>
    ls
      .filter((l) => l.qty > 0 && (l.productId || l.rawDescription.trim()))
      .map((l) => ({
        productId: l.productId ?? null,
        rawDescription: l.rawDescription.trim() || null,
        qty: l.qty,
        unit: l.unit,
        unitPriceExpected: l.unitPriceExpected ?? null,
      }));

  /**
   * Save the cart as THE server draft (W2-06 §5.7): one draft per (supplier, me),
   * versioned by xmin. A stale version → the newer server draft is loaded and
   * named; a draft that was sent / received elsewhere → dropStale.
   */
  async function syncServerDraft(snapshot: CartLine[]): Promise<string | null> {
    const payload = savableLines(snapshot);
    if (payload.length === 0 && !draftId) return null;
    setServerSave('saving');
    try {
      const r = await saveDraftM.mutateAsync({
        draftId,
        supplierId,
        lines: payload,
        // A scheduled supplier's date is re-derived on the server unless the manager picked one.
        deliveryDate: deliveryDate || (delivery.data?.derived ? null : deliveryDay || null),
        version: versionRef.current,
        clientMutationId: newKey(),
      });
      versionRef.current = r.version;
      // What is on the server now: the background save skips an identical re-save.
      lastSaved.current = `${supplierId}|${deliveryDate}|${JSON.stringify(payload)}`;
      if (r.draftId !== draftId) {
        // Persist the id NOW: a reload before the next render must find this draft.
        const savedCart = store.current.carts[supplierId];
        store.current = {
          ...withCart(store.current, supplierId, {
            ...(savedCart ?? emptyCart()),
            lines: snapshot,
            deliveryDate,
            channel,
            draftId: r.draftId,
            server: null,
            updatedAt: Date.now(),
          }),
          activeSupplierId: supplierId,
        };
        saveStore(restaurantId, store.current);
        setDraftId(r.draftId);
      }
      // Prices the server filled in (contract > last sent > list) show at once.
      setLines((ls) => {
        let changed = false;
        const next = ls.map((l) => {
          if (l.unitPriceExpected != null || !l.productId) return l;
          const m = r.lines.find((x) => x.productId === l.productId && x.unit === l.unit && x.unitPriceExpected != null);
          if (!m) return l;
          changed = true;
          return { ...l, unitPriceExpected: m.unitPriceExpected ?? undefined };
        });
        return changed ? next : ls;
      });
      setServerSave('saved');
      return r.draftId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (trpcErrorCode(e) === 'CONFLICT' && msg.startsWith('DRAFT_STALE:')) {
        // `DRAFT_STALE:<who>:<ISO>` — the ISO has colons, so take it from the end.
        const rest = msg.slice('DRAFT_STALE:'.length);
        const iso = /\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.exec(rest)?.[0] ?? '';
        const by = rest.slice(0, Math.max(0, rest.length - iso.length - 1));
        await restoreServerDraft(supplierId);
        toast.error(
          t('w2.staleDraft', {
            by: by || '—',
            at: iso ? formatDate(iso, locale, { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '',
          }),
        );
        setServerSave('idle');
        return null;
      }
      if (trpcErrorCode(e) === 'CONFLICT' && draftId) throw new StaleDraftError(draftId, 'sent');
      setServerSave('failed');
      throw e;
    }
  }

  async function ensureServerDraft(): Promise<string> {
    // A background save may be mid-flight: let it land first.
    if (syncing.current) await syncing.current.catch(() => undefined);
    if (draftId) {
      try {
        const cur = await utils.orders.get.fetch({ poId: draftId });
        if (cur.po && cur.po.status !== 'draft') throw new StaleDraftError(draftId, cur.po.status);
      } catch (e) {
        if (e instanceof StaleDraftError) throw e;
        if (trpcErrorCode(e) !== 'NOT_FOUND') throw e; // unreachable: never guess, never duplicate
        setDraftId(null);
        versionRef.current = null;
      }
    }
    const id = await syncServerDraft(lines);
    if (!id) throw new Error('draft not saved');
    await readBack(id, lines);
    return id;
  }

  /** The draft is gone from "unsent": drop the device cart and say where the order is. */
  function dropStale(err: StaleDraftError) {
    store.current = withCart(store.current, supplierId, null);
    saveStore(restaurantId, store.current);
    applyCart(emptyCart());
    setSending(null);
    setStale({ supplierId, poId: err.poId, status: err.status });
    setStep('BUILD');
  }

  async function save(): Promise<string | null> {
    setSaving(true);
    setSaveError(null);
    try {
      return await ensureServerDraft();
    } catch (e) {
      if (e instanceof StaleDraftError) dropStale(e);
      else setSaveError(e);
      return null;
    } finally {
      setSaving(false);
    }
  }

  // ── Every line is saved on the server (debounced): a reload, another browser of
  //    the same user, or a supplier switch never loses the order (orders-07 P0).
  const syncing = useRef<Promise<unknown> | null>(null);
  const linesSig = JSON.stringify(savableLines(lines));
  const lastSaved = useRef<string>('');
  useEffect(() => {
    if (!hydrated || !supplierId || saving || sending || step === 'SENT' || reorderOpen) return;
    const sig = `${supplierId}|${deliveryDate}|${linesSig}`;
    if (sig === lastSaved.current) return;
    if (!draftId && linesSig === '[]') return;
    const timer = window.setTimeout(() => {
      if (syncing.current) return;
      const snapshot = lines;
      syncing.current = syncServerDraft(snapshot)
        .catch((e) => {
          if (e instanceof StaleDraftError) dropStale(e);
          // Otherwise quiet: the chip says "לא נשמר" and the next change retries.
        })
        .finally(() => {
          syncing.current = null;
        });
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, supplierId, linesSig, deliveryDate, draftId, saving, sending, step, reorderOpen]);

  function goReview() {
    if (!valid) return;
    setStep('REVIEW');
    void once(async () => {
      await save();
    });
  }

  function startSend() {
    once(async () => {
      placeOrder.reset();
      const poId = await save();
      if (poId) setSending({ poId, deadline: Date.now() + UNDO_MS });
    });
  }

  /**
   * "מהוואטסאפ שלי" (§5.3). First tap: save and fetch the exact text (the explicit
   * choice). Second tap: open wa.me SYNCHRONOUSLY with the text already in memory
   * (iOS blocks window.open after an await), then record the send — no outbox row.
   */
  function manualTap() {
    if (!manual) {
      once(async () => {
        const poId = await save();
        if (!poId) return;
        try {
          const p = await utils.orders.prepareManualSend.fetch({ poId });
          setManual({ poId, text: p.text, to: p.whatsappTo });
        } catch (e) {
          setSaveError(e);
        }
      });
      return;
    }
    if (!manual.to) {
      toast.error(t('w2.manual.noPhone'));
      return;
    }
    openWhatsappNow(waLink(manual.to, manual.text));
    const poId = manual.poId;
    markManual.mutate(
      { poId, clientMutationId: `manual-${poId}` },
      {
        onSuccess: () => {
          store.current = withCart(store.current, supplierId, null);
          saveStore(restaurantId, store.current);
          setSent({ poId, channel: 'manual', supplier: supplierLabel, day: deliveryDay });
          setStep('SENT');
          setManual(null);
          void utils.orders.list.invalidate();
        },
        onError: (e) => setSaveError(e),
      },
    );
  }

  async function commitSend(poId: string) {
    setSending(null);
    try {
      if (effectiveChannel === 'manual') return; // recorded through manualTap, never queued
      await placeOrder.mutateAsync({ poId, channel: effectiveChannel });
      store.current = withCart(store.current, supplierId, null);
      saveStore(restaurantId, store.current);
      setSent({ poId, channel: effectiveChannel, supplier: supplierLabel, day: deliveryDay });
      setStep('SENT');
    } catch {
      // Surfaced below via placeOrder.error; the draft stays.
    }
  }

  const placeErr = placeOrder.error;
  const placeErrMsg = placeErr
    ? entitlementCauseOf(placeErr)
      ? t('errors.whatsappGated')
      : friendlyError(placeErr, tc, {
          BAD_REQUEST: t('errors.noContact', {
            channel: t(`detail.channelNames.${effectiveChannel === 'whatsapp' ? 'whatsapp' : 'email'}`),
          }),
        })
    : null;

  const reset = () => {
    setSent(null);
    setStep('SUPPLIER');
    setSupplierId('');
    applyCart(emptyCart());
    setRawSearch('');
    setReorderInfo(null);
    createDraft.reset();
    placeOrder.reset();
    setUrl('');
  };

  const money = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const dayLong = (iso: string) => formatDate(`${iso}T12:00:00Z`, locale, { weekday: 'long', day: 'numeric', month: 'numeric' });
  const dayShort = (iso: string) => formatDate(`${iso}T12:00:00Z`, locale, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const itemsLabel = (n: number) => (n === 1 ? t('wizard.itemsOne') : t('wizard.items', { count: formatNumber(n, locale) }));
  const excludesLabel = unpriced === 0 ? null : unpriced === 1 ? t('wizard.totalExcludesOne') : t('wizard.totalExcludes', { count: formatNumber(unpriced, locale) });
  const ctaLabel =
    effectiveChannel === 'manual'
      ? manual
        ? t('w2.manual.open')
        : t('w2.manual.choice')
      : t(`send.cta.${effectiveChannel}`, { supplier: supplierLabel });
  const busy = saving || placeOrder.isPending || markManual.isPending || !!sending;
  const cartCarts = hydrated ? store.current.carts : {};

  // ───────────────────────────────── render ─────────────────────────────────
  return (
    <FieldMode className="mx-auto max-w-3xl pb-40 lg:pb-32">
      <div ref={rootRef}>
        {/* Task chrome: exit at the start, the step at the end — no breadcrumbs, no nav. */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <Link
            href="/dashboard/orders"
            className="inline-flex min-h-12 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="wizard-exit"
          >
            <X className="h-5 w-5" aria-hidden="true" /> {t('draft.exit')}
          </Link>
          {step !== 'SENT' ? (
            <span className="text-sm tabular-nums text-muted" data-testid="wizard-step" aria-hidden="true">
              {t('wizard.stepOf', { n: formatNumber(STEP_NO[step], locale) })}
            </span>
          ) : null}
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="mb-1 text-xl font-bold text-ink focus:outline-none">
          {step !== 'SENT' ? (
            <span className="sr-only">{t('wizard.stepOf', { n: formatNumber(STEP_NO[step], locale) })}, </span>
          ) : null}
          {step === 'SUPPLIER' || !supplierLabel ? t('wizard.title') : `${t('wizard.title')} · ${supplierLabel}`}
        </h1>
        <p className="mb-4 text-sm text-muted">{t('wizard.subtitle')}</p>
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>

        {switchUndo ? (
          <UndoCountdown
            className="mb-3"
            testId="switch-undo"
            deadline={switchUndo.deadline}
            message={() =>
              t('draft.switched', {
                to: nameOf(suppliers.data?.find((s) => s.id === switchUndo.to)),
                from: nameOf(suppliers.data?.find((s) => s.id === switchUndo.from)),
                count: formatNumber(switchUndo.count, locale),
              })
            }
            undoLabel={t('draft.undo')}
            onUndo={() => {
              const u = switchUndo;
              setSwitchUndo(null);
              selectSupplier(u.from, u.fromStep === 'SENT' ? 'BUILD' : u.fromStep);
            }}
            onElapse={() => setSwitchUndo(null)}
          />
        ) : null}

        {stale ? (
          <Card elevated className="mb-4 border-warn/50" data-testid="stale-draft">
            <p className="flex items-start gap-2 text-sm text-ink" role="status">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              {t(stale.status === 'cancelled' ? 'draft.staleCancelled' : 'draft.staleSent', {
                supplier: nameOf(suppliers.data?.find((x) => x.id === stale.supplierId)),
                ref: ltrIsolate(`#${poRefOf(stale.poId)}`),
              })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <LinkButton href={`/dashboard/orders/${stale.poId}`} variant="secondary" className="min-h-12">
                {t('draft.staleOpen')}
              </LinkButton>
              <Button variant="ghost" className="min-h-12" onClick={() => setStale(null)}>
                {t('draft.close')}
              </Button>
            </div>
          </Card>
        ) : null}

        {resumeOffer && step === 'SUPPLIER' ? (
          <Card elevated className="mb-4 border-primary/40" data-testid="resume-offer">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <History className="h-4 w-4 text-primary" aria-hidden="true" />
              {t('draft.resumeTitle', { supplier: nameOf(suppliers.data?.find((s) => s.id === resumeOffer.supplierId)) })}
            </p>
            <p className="mt-1 text-sm text-muted">{t('draft.resumeBody')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => selectSupplier(resumeOffer.supplierId)} className="min-h-12">
                {t('draft.resume', { count: formatNumber(resumeOffer.count, locale) })}
              </Button>
              <Button variant="ghost" className="min-h-12" onClick={() => discardDraft(resumeOffer.supplierId)}>
                {t('draft.discard')}
              </Button>
            </div>
          </Card>
        ) : null}

        {fromPoId && !reorderDone ? (
          <Card elevated className="mb-4">
            <p className="flex items-center gap-2 text-sm text-muted" role="status">
              <Spinner className="h-4 w-4" /> {t('reorder.loading')}
            </p>
          </Card>
        ) : null}

        {pendingReorder ? (
          <Card elevated className="mb-4 border-warn/50" data-testid="reorder-choice">
            <p className="font-semibold text-ink" role="status">
              {t('reorder.draftExistsTitle', {
                supplier: nameOf(suppliers.data?.find((s) => s.id === pendingReorder.supplierId)),
                count: formatNumber(
                  pendingReorder.existing.kind === 'local' ? pendingReorder.existing.cart.lines.length : pendingReorder.existing.count,
                  locale,
                ),
              })}
            </p>
            <p className="mt-1 text-sm text-muted">{t('reorder.draftExistsBody')}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button className="min-h-14" onClick={() => void resolveReorder('attach')}>
                {t('reorder.attach')}
              </Button>
              <Button className="min-h-14" variant="secondary" onClick={() => void resolveReorder('replace')}>
                {t('reorder.replace')}
              </Button>
              <Button className="min-h-14 sm:col-span-2" variant="ghost" onClick={() => void resolveReorder('keep')}>
                {t('reorder.keep')}
              </Button>
            </div>
          </Card>
        ) : null}

        {step === 'SUPPLIER' && (
          <Card elevated flow>
            {suppliers.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-muted">
                <Spinner className="h-4 w-4" />
              </div>
            ) : (suppliers.data ?? []).length === 0 ? (
              <EmptyState
                title={t('wizard.noSuppliers')}
                action={
                  <LinkButton href="/dashboard/suppliers" size="sm">
                    {t('wizard.addSupplier')}
                  </LinkButton>
                }
              />
            ) : (
              <>
                <h2 className="mb-2 text-base font-bold text-ink">{t('wizard.pickSupplier')}</h2>
                <SupplierBoard
                  current={supplierId}
                  localDraftCount={(id) => cartCarts[id]?.lines.length ?? 0}
                  onPick={(id) => selectSupplier(id)}
                />
              </>
            )}
          </Card>
        )}

        {step === 'BUILD' && reorderDone && !pendingReorder && (
          <div className="space-y-4">
            {restoredNote ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="draft-restored">
                <History className="h-4 w-4 text-primary" aria-hidden="true" />
                {t('draft.resume', { count: formatNumber(restoredNote, locale) })} ✓
                <button
                  type="button"
                  className="min-h-11 rounded px-1 text-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => discardDraft(supplierId)}
                >
                  {t('draft.discard')}
                </button>
              </p>
            ) : null}
            {reorderInfo ? <ReorderNotice info={reorderInfo} /> : null}
            {supplierId ? <GuidePanel supplierId={supplierId} lines={lines} onLines={setLines} newKey={newKey} /> : null}
            <Card elevated>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">
                  {t('wizard.supplierLabel')} <span className="font-semibold text-ink">{supplierLabel}</span>
                  {serverSave !== 'idle' ? (
                    <span
                      role="status"
                      data-testid="server-save"
                      data-state={serverSave}
                      className={cn('ms-2 text-xs', serverSave === 'failed' ? 'text-danger' : 'text-subtle')}
                    >
                      · {serverSave === 'saving' ? t('w2.saving') : serverSave === 'saved' ? t('w2.savedServer') : t('w2.saveFailed')}
                    </span>
                  ) : null}
                </p>
                <Button variant="secondary" size="sm" className="min-h-11" onClick={() => setPickerOpen(true)} data-testid="change-supplier">
                  <Repeat className="h-4 w-4" aria-hidden="true" /> {t('draft.changeSupplier')}
                </Button>
              </div>
              <Field label={t('wizard.addFromCatalog')} htmlFor="ord-search">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
                    aria-hidden="true"
                  />
                  <Input
                    id="ord-search"
                    type="search"
                    value={rawSearch}
                    onChange={(e) => setRawSearch(e.target.value)}
                    placeholder={t('wizard.searchPlaceholder')}
                    className="ps-9 text-base"
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                </div>
              </Field>
              {!search && (catalog.data ?? []).length > 0 ? (
                <p className="mt-2 text-xs text-subtle">{t('wizard.browseHint')}</p>
              ) : null}
              {/* Phones: the list flows with the page (no inner scroll box), so focus scrolling
                  keeps every item clear of the sticky cart bar (WCAG 2.4.11). */}
              <div className="mt-2 rounded-xl border border-line sm:max-h-72 sm:overflow-y-auto">
                {catalog.isLoading ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-muted">
                    <Spinner className="h-4 w-4" /> {t('wizard.searching')}
                  </div>
                ) : (catalog.data ?? []).length === 0 ? (
                  search ? (
                    <p className="p-3 text-sm text-subtle">{t('wizard.noCatalogResults')}</p>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-subtle">
                      <span>{t('wizard.catalogEmpty')}</span>
                      <LinkButton href={`/dashboard/catalog/import?supplierId=${supplierId}`} size="sm" variant="secondary">
                        <Upload className="h-4 w-4" aria-hidden="true" /> {t('wizard.importCatalog')}
                      </LinkButton>
                    </div>
                  )
                ) : (
                  <ul>
                    {(catalog.data ?? []).map((it) => {
                      const name = displayName(it.supplierNameRaw, it.productNameEn, locale);
                      const unit = it.unit ?? (locale === 'en' ? 'unit' : 'יח׳');
                      const listPrice = contractPrice(it.productId, unit) ?? (it.listPrice != null ? Number(it.listPrice) : undefined);
                      return (
                        <li key={it.id} className="border-b border-line/60 last:border-0">
                          <button
                            type="button"
                            data-testid="catalog-item"
                            onClick={() =>
                              addLine({
                                productId: it.productId ?? undefined,
                                rawDescription: it.supplierNameRaw,
                                nameEn: it.productNameEn,
                                // No invented qty (orders-01): the line starts empty.
                                qty: 0,
                                unit,
                                unitPriceExpected: listPrice,
                              })
                            }
                            className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-ink">{name.primary}</span>
                              {name.secondary || it.supplierSku ? (
                                <span className="block truncate text-xs text-subtle">
                                  {[name.secondary, it.supplierSku].filter(Boolean).join(' · ')}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted">
                              {listPrice !== undefined ? money(listPrice) : '—'}
                              {it.unit ? (
                                <span>
                                  / <UnitText unit={it.unit} />
                                </span>
                              ) : null}
                              <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  onClick={() =>
                    setLines((ls) => [...ls, { key: newKey(), rawDescription: '', qty: 0, unit: locale === 'en' ? 'unit' : 'יח׳' }])
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> {t('wizard.addFreeLine')}
                </Button>
              </div>
            </Card>

            <Card elevated>
              {lines.length === 0 ? (
                <EmptyState title={t('wizard.emptyOrderTitle')} description={t('wizard.emptyOrderBody')} />
              ) : (
                <ul className="space-y-3" data-testid="order-lines">
                  {lines.map((l) => {
                    const name = displayName(l.rawDescription, l.nameEn, locale);
                    const label = name.primary || t('wizard.freeLinePlaceholder');
                    return (
                      <li
                        key={l.key}
                        data-testid="order-line"
                        className="grid grid-cols-[5rem_4.5rem_5.5rem_minmax(0,1fr)_auto] items-end gap-x-2 gap-y-2 border-b border-line/60 pb-3 last:border-0 sm:grid-cols-[minmax(10rem,1fr)_5rem_5rem_6rem_6rem_auto] sm:gap-x-3"
                      >
                        <div className="order-1 col-span-4 min-w-0 sm:order-none sm:col-span-1">
                          {l.productId ? (
                            <>
                              <p className="truncate text-sm text-ink">{name.primary}</p>
                              {name.secondary ? (
                                <p className="truncate text-xs text-subtle" lang="he">
                                  {name.secondary}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <Input
                              value={l.rawDescription}
                              onChange={(e) => patchLine(l.key, { rawDescription: e.target.value })}
                              placeholder={t('wizard.freeLinePlaceholder')}
                              aria-label={t('wizard.freeLinePlaceholder')}
                              maxLength={400}
                              aria-invalid={!l.rawDescription.trim() || undefined}
                              className="text-base"
                            />
                          )}
                          <OverContractNote price={l.unitPriceExpected} contract={contractPrice(l.productId, l.unit)} />
                        </div>
                        <label className="order-3 min-w-0 text-xs text-subtle sm:order-none">
                          {t('wizard.qty')}
                          <DecimalInput
                            kind="qty"
                            value={l.qty > 0 ? l.qty : undefined}
                            placeholder={t('w2.qtyEmpty')}
                            onValue={(v) => patchLine(l.key, { qty: v ?? 0 })}
                            aria-label={t('wizard.qtyOf', { name: label })}
                            className="mt-0.5 min-h-12 px-2 text-end text-base tabular-nums"
                          />
                        </label>
                        <label className="order-3 min-w-0 text-xs text-subtle sm:order-none">
                          {t('wizard.unit')}
                          <Input
                            value={l.unit}
                            onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                            maxLength={32}
                            className="mt-0.5 min-h-12 px-2 text-base"
                          />
                        </label>
                        <label className="order-3 min-w-0 text-xs text-subtle sm:order-none">
                          {t('wizard.price')}
                          <DecimalInput
                            kind="price"
                            value={l.unitPriceExpected}
                            onValue={(v) => patchLine(l.key, { unitPriceExpected: v, priceSource: undefined })}
                            aria-label={t('wizard.priceOf', { name: label })}
                            className="mt-0.5 min-h-12 px-2 text-end text-base tabular-nums"
                          />
                        </label>
                        <span className="order-3 pb-3 text-end text-sm tabular-nums text-ink sm:order-none">
                          {/* No price yet ≠ free: "—", not ₪0.00. */}
                          {l.unitPriceExpected == null ? '—' : money(lineTotalIls(l.qty, l.unitPriceExpected))}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(l.key)}
                          className="order-2 inline-flex h-12 w-12 items-center justify-center justify-self-end rounded-xl text-subtle hover:bg-surface-2 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:order-none"
                          aria-label={t('wizard.remove', { name: label })}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                  <li className="flex flex-wrap items-baseline justify-between gap-x-3 pt-1 text-sm font-semibold text-ink">
                    <span>{t('wizard.total')}</span>
                    <span className="tabular-nums" data-testid="order-total">
                      {money(total)}
                    </span>
                    {excludesLabel ? <span className="w-full text-end text-xs font-normal text-muted">{excludesLabel}</span> : null}
                  </li>
                </ul>
              )}
              {lines.length > 0 && !valid ? <p className="mt-3 text-sm text-warn">{t('wizard.fixLines')}</p> : null}
              {lines.length > 0 ? (
                <DeliveryChips
                  d={delivery.data ?? null}
                  loading={delivery.isLoading}
                  options={options}
                  value={deliveryDay}
                  onChange={setDeliveryDate}
                  disabled={busy}
                  dayShort={dayShort}
                  dayLong={dayLong}
                />
              ) : null}
            </Card>
          </div>
        )}

        {step === 'REVIEW' && (
          <Card elevated flow>
            {reorderInfo ? <ReorderNotice info={reorderInfo} compact /> : null}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-ink">{t('wizard.reviewTitle', { supplier: supplierLabel })}</h2>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                disabled={busy}
                onClick={() => setStep('BUILD')}
              >
                <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" /> {t('wizard.back')}
              </Button>
            </div>
            <ul className="space-y-2">
              {lines.map((l) => {
                const w = l.productId ? warningsByProduct.get(l.productId) : undefined;
                const name = displayName(l.rawDescription, l.nameEn, locale);
                return (
                  <li key={l.key} className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 last:border-0">
                    {/* The price badges sit under the name so they never squeeze it (phone). */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{name.primary}</p>
                      {w && (
                        <Badge
                          tone={w.level === 'high' ? 'danger' : 'warning'}
                          icon={<TriangleAlert className="h-3 w-3" aria-hidden="true" />}
                          className="mt-1"
                        >
                          {w.level === 'high'
                            ? t('wizard.aboveP90')
                            : t('wizard.aboveMedian', { pct: formatPercent(w.pctOverMedian, locale, 0) })}
                        </Badge>
                      )}
                      {l.priceSource && l.priceSource !== 'none' ? (
                        <p className="text-xs text-subtle">
                          {t(
                            l.priceSource === 'contract'
                              ? 'reorder.priceContract'
                              : l.priceSource === 'catalog'
                                ? 'reorder.priceCatalog'
                                : 'reorder.priceLast',
                          )}
                        </p>
                      ) : null}
                      <OverContractNote price={l.unitPriceExpected} contract={contractPrice(l.productId, l.unit)} />
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted">
                      <bdi>{formatNumber(l.qty, locale, { maximumFractionDigits: 3 })}</bdi> <UnitText unit={l.unit} />
                      {l.unitPriceExpected !== undefined ? <> × {money(l.unitPriceExpected)}</> : null}
                    </span>
                    <span className="w-24 shrink-0 text-end text-sm tabular-nums text-ink">
                      {l.unitPriceExpected == null ? '—' : money(lineTotalIls(l.qty, l.unitPriceExpected))}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold text-ink">
              <span>{t('wizard.total')}</span>
              <span className="tabular-nums" data-testid="review-total">
                {money(total)}
              </span>
              {excludesLabel ? (
                <span className="w-full text-end text-xs font-normal text-muted" data-testid="total-excludes">
                  {excludesLabel}
                </span>
              ) : null}
            </div>

            {/* The day was settled while building (before the server draft); changing it goes back. */}
            {deliveryDay ? (
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink" data-testid="order-delivery-headline">
                <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>
                  {t('wizard.deliveryExpected')} <span className="font-semibold">{dayLong(deliveryDay)}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep('BUILD')}
                  className="min-h-11 rounded px-1 text-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                >
                  {t('wizard.changeDay')}
                </button>
              </p>
            ) : null}

            {guardrail.isFetching && (
              <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
                <Spinner className="h-3.5 w-3.5" /> {t('wizard.checkingBaseline')}
              </p>
            )}
            {guardrailGated && <p className="mt-3 text-xs text-subtle">{t('wizard.guardrailGated')}</p>}

            <div className="mt-5 space-y-3 border-t border-line pt-4">
              {/* Short options (they never clip at 390 px); the destination shows under the field. */}
              <Field
                label={t('wizard.channel')}
                htmlFor="ord-channel"
                hint={
                  effectiveChannel === 'email' && supplier?.contactEmail ? (
                    <bdi dir="ltr">{supplier.contactEmail}</bdi>
                  ) : (effectiveChannel === 'whatsapp' || effectiveChannel === 'manual') && supplier?.contactWhatsapp ? (
                    <bdi dir="ltr">{supplier.contactWhatsapp}</bdi>
                  ) : undefined
                }
              >
                <Select
                  id="ord-channel"
                  value={effectiveChannel}
                  onChange={(e) => setChannel(e.target.value as Channel)}
                  disabled={busy}
                  className="min-h-12 text-base"
                >
                  <option value="email" disabled={!supplier?.contactEmail}>
                    {supplier?.contactEmail ? t('wizard.channelEmail') : `${t('wizard.channelEmail')} — ${t('wizard.channelMissing')}`}
                  </option>
                  <option value="whatsapp" disabled={!supplier?.contactWhatsapp}>
                    {supplier?.contactWhatsapp
                      ? t('wizard.channelWhatsapp')
                      : `${t('wizard.channelWhatsapp')} — ${t('wizard.channelMissing')}`}
                  </option>
                  <option value="manual" disabled={!supplier?.contactWhatsapp}>
                    {supplier?.contactWhatsapp ? t('w2.manual.choice') : `${t('w2.manual.choice')} — ${t('wizard.channelMissing')}`}
                  </option>
                  <option value="none">{t('wizard.channelNone')}</option>
                </Select>
              </Field>
              {effectiveChannel === 'manual' ? (
                <div className="space-y-2" data-testid="manual-send">
                  <p className="text-xs text-muted">{t('w2.manual.hint')}</p>
                  {manual ? (
                    <pre
                      dir="rtl"
                      data-testid="manual-text"
                      className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-3 font-sans text-sm text-ink"
                    >
                      {manual.text}
                    </pre>
                  ) : null}
                </div>
              ) : null}

              {/* What the supplier will receive — literally, whenever something is sent. */}
              {effectiveChannel !== 'none' && effectiveChannel !== 'manual' && supplierId && valid ? (
                pricedDoc ? (
                  <div className="space-y-2">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="prices-chip">
                      <Badge tone="neutral">{docSettings.data?.showPrices ? t('wizard.pricesOn') : t('wizard.pricesOff')}</Badge>
                      {draftId ? (
                        <Link
                          href={`/dashboard/orders/${draftId}#supplier-document`}
                          className="rounded text-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {t('wizard.pricesChange')}
                        </Link>
                      ) : null}
                    </p>
                    {draftId && !saving ? (
                      <InlineDocument key={`${draftId}:${docVersion}`} poId={draftId} channel={effectiveChannel} />
                    ) : (
                      <p className="flex items-center gap-2 text-xs text-subtle">
                        <Spinner className="h-3.5 w-3.5" /> {t('send.saving')}
                      </p>
                    )}
                  </div>
                ) : (
                  <OrderDocumentPreview
                    input={{
                      supplierId,
                      expectedDeliveryDate: deliveryDay || undefined,
                      lines: lines.map((l) => ({
                        productId: l.productId ?? undefined,
                        rawDescription: l.rawDescription || undefined,
                        qty: l.qty,
                        unit: l.unit,
                      })),
                    }}
                  />
                )
              ) : null}

              {placeErrMsg && (
                <p role="alert" className="text-sm text-danger">
                  {placeErrMsg}
                </p>
              )}
              {saveError ? (
                <p role="alert" className="text-sm text-danger">
                  {friendlyError(saveError, tc)}
                </p>
              ) : null}
              {draftId && placeErr ? (
                <p className="text-sm text-muted">
                  {t('wizard.draftSaved')}{' '}
                  <Link href={`/dashboard/orders/${draftId}`} className="text-primary underline">
                    {t('wizard.openDraft')}
                  </Link>
                </p>
              ) : null}
            </div>
          </Card>
        )}

        {step === 'SENT' && sent && (
          <Card elevated flow className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
            <p className="mt-3 text-lg font-semibold text-ink" role="status">
              {sent.channel === 'none'
                ? t('wizard.markedTitle')
                : sent.channel === 'manual'
                  ? t('w2.manual.done')
                  : t('wizard.sentTitle', {
                    supplier: sent.supplier,
                    channel: t(`detail.channelNames.${sent.channel}`),
                  })}
            </p>
            <p className="mt-1 text-sm text-muted">
              {sent.channel === 'none' || sent.channel === 'manual'
                ? sent.channel === 'none'
                  ? t('wizard.markedBody')
                  : ''
                : sent.day
                  ? t('wizard.sentBody', { date: dayLong(sent.day) })
                  : t('wizard.sentBodyNoDate')}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <LinkButton href={`/dashboard/orders/${sent.poId}`} className="min-h-12">
                {t('wizard.viewOrder')}
              </LinkButton>
              <LinkButton href="/dashboard/orders" variant="secondary" className="min-h-12">
                {t('wizard.toList')}
              </LinkButton>
              <Button variant="ghost" className="min-h-12" onClick={reset}>
                {t('wizard.another')}
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* The cart bar: count · ₪ · delivery, and the one primary — in the thumb zone. */}
      {(step === 'BUILD' || step === 'REVIEW') && reorderDone && !pendingReorder ? (
        <div
          data-testid="cart-bar"
          data-field-bar=""
          className="fixed inset-x-0 bottom-[var(--consent-h,0px)] z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-card backdrop-blur"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
            {sending ? (
              <UndoCountdown
                className="w-full border-primary/40"
                testId="send-undo"
                autoFocus
                deadline={sending.deadline}
                message={(s) =>
                  effectiveChannel === 'none'
                    ? t('send.countdownNone', { seconds: formatNumber(s, locale) })
                    : t('send.countdown', { supplier: supplierLabel, seconds: formatNumber(s, locale) })
                }
                undoLabel={t('send.undo')}
                onUndo={() => {
                  setSending(null);
                  toast.success(t('send.undone'));
                }}
                onElapse={() => void commitSend(sending.poId)}
              />
            ) : (
              <>
                <p className="min-h-6 truncate text-sm tabular-nums text-ink" data-testid="cart-summary">
                  <span className="font-semibold">{itemsLabel(lines.length)}</span>
                  {' · '}
                  {money(total)}
                  {deliveryDay ? (
                    <>
                      {' · '}
                      <span className="text-muted">{t('list.delivery', { date: dayShort(deliveryDay) })}</span>
                    </>
                  ) : null}
                </p>
                {step === 'BUILD' ? (
                  <Button
                    data-testid="cart-primary"
                    className="h-14 w-full text-base sm:w-auto sm:min-w-64"
                    disabled={!valid}
                    onClick={goReview}
                  >
                    {t('wizard.toReview')} <ArrowRight className={fwd} aria-hidden="true" />
                  </Button>
                ) : (
                  <Button
                    data-testid="cart-primary"
                    className="h-14 w-full text-base sm:w-auto sm:min-w-64"
                    disabled={!valid || placeOrder.isPending || markManual.isPending}
                    loading={saving || placeOrder.isPending || markManual.isPending}
                    onClick={effectiveChannel === 'manual' ? manualTap : startSend}
                  >
                    {ctaLabel}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      <SupplierSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        suppliers={suppliers.data ?? []}
        current={supplierId}
        nameOf={nameOf}
        draftCount={(id) => (id === supplierId ? lines.length : (cartCarts[id]?.lines.length ?? 0))}
        onPick={switchSupplier}
      />
    </FieldMode>
  );
}

/** Suppliers as 56 px rows (no native select): one tap picks and moves on. */
function SupplierRows({
  suppliers,
  current,
  nameOf,
  draftCount,
  onPick,
}: {
  suppliers: Supplier[];
  current: string;
  nameOf: (s: Supplier) => string;
  draftCount: (id: string) => number;
  onPick: (id: string) => void;
}) {
  const t = useT(ordersNs);
  const locale = useLocale();
  return (
    <ul className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line" aria-label={t('wizard.supplierRows')}>
      {suppliers.map((s) => {
        const n = draftCount(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              data-testid="supplier-row"
              aria-current={s.id === current ? 'true' : undefined}
              onClick={() => onPick(s.id)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-start hover:bg-surface-2 focus:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <span className="min-w-0 truncate font-medium text-ink">{nameOf(s)}</span>
              <span className="flex shrink-0 items-center gap-2">
                {n > 0 ? <Badge tone="neutral">{t('draft.hasDraft', { count: formatNumber(n, locale) })}</Badge> : null}
                <ArrowRight className={cn(fwd, 'text-subtle')} aria-hidden="true" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The change-supplier sheet (a modal <dialog> docked to the bottom on phones). */
function SupplierSheet({
  open,
  onClose,
  ...rows
}: {
  open: boolean;
  onClose: () => void;
} & React.ComponentProps<typeof SupplierRows>) {
  const t = useT(ordersNs);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || typeof d.showModal !== 'function') return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="supplier-sheet-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto max-h-[85vh] w-full max-w-none rounded-t-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/50 sm:!m-auto sm:w-[min(92vw,28rem)] sm:rounded-2xl"
    >
      {open ? (
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="supplier-sheet-title" className="text-base font-bold text-ink">
              {t('draft.changeTitle')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('draft.close')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            <SupplierRows {...rows} />
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

function ReorderNotice({ info, compact = false }: { info: { ref: string; unavailable: string[]; count: number }; compact?: boolean }) {
  const t = useT(ordersNs);
  const locale = useLocale();
  return (
    <div className={cn('rounded-xl border border-line bg-surface-2 p-3 text-sm', compact ? 'mb-3' : '')} data-testid="reorder-notice">
      <p className="flex items-center gap-2 font-medium text-ink">
        <Repeat className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('reorder.from', { ref: ltrIsolate(`#${info.ref}`) })}
      </p>
      {!compact ? <p className="mt-1 text-muted">{t('reorder.added', { count: formatNumber(info.count, locale) })}</p> : null}
      {info.unavailable.length > 0 ? (
        <div className="mt-2" data-testid="reorder-unavailable">
          <p className="text-muted">{t('reorder.unavailable')}</p>
          <ul className="ms-5 list-disc text-ink">
            {info.unavailable.map((n, i) => (
              <li key={`${n}-${i}`}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The delivery day as chips — the next three valid days, each with why ("הזמנה עד
 * 16:00 היום → אספקה מחר") — plus any other date. Starts at the server's default
 * (schedule-derived, else tomorrow past Fri/Sat); a passed cutoff is a calm line.
 */
function DeliveryChips({
  d,
  loading,
  options,
  value,
  onChange,
  disabled,
  dayShort,
  dayLong,
}: {
  d: DeliveryPreview | null;
  loading: boolean;
  options: DeliveryOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  dayShort: (iso: string) => string;
  dayLong: (iso: string) => string;
}) {
  const t = useT(ordersNs);
  if (loading || !d) return null;
  const today = d.today;
  const rel = (iso: string) =>
    iso === today ? t('wizard.today') : iso === addDays(today, 1) ? t('wizard.tomorrow') : dayShort(iso);
  const chips = options.some((o) => o.date === value) || !value ? options : [{ date: value, orderBy: null }, ...options].slice(0, 4);
  const picked = chips.find((o) => o.date === value) ?? null;
  const reason = picked?.orderBy
    ? picked.orderBy.date === today
      ? t('wizard.reasonToday', { time: picked.orderBy.cutoff, day: rel(picked.date) })
      : t('wizard.reasonOn', { time: picked.orderBy.cutoff, orderDay: dayShort(picked.orderBy.date), day: rel(picked.date) })
    : null;
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
      {value ? (
        <p className="flex items-center gap-2 text-ink" data-testid="order-delivery-headline">
          <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>
            {t('wizard.deliveryExpected')} <span className="font-semibold">{dayLong(value)}</span>
          </span>
        </p>
      ) : null}
      <div role="radiogroup" aria-label={t('wizard.deliveryDay')} className="mt-3 flex flex-wrap gap-2">
        {chips.map((o) => (
          <button
            key={o.date}
            type="button"
            role="radio"
            aria-checked={o.date === value}
            disabled={disabled}
            data-testid="delivery-chip"
            data-date={o.date}
            onClick={() => onChange(o.date)}
            className={cn(
              'min-h-12 rounded-xl border px-3 text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60',
              o.date === value ? 'border-primary bg-surface font-semibold text-primary' : 'border-line bg-surface text-ink hover:border-primary/40',
            )}
          >
            {o.date === today || o.date === addDays(today, 1) ? `${rel(o.date)} · ${dayShort(o.date)}` : dayShort(o.date)}
          </button>
        ))}
      </div>
      {reason ? <p className="mt-2 text-xs text-muted" data-testid="delivery-reason">{reason}</p> : null}
      {d.derived ? (
        d.derived.missedCutoff ? (
          <p className="mt-2 text-xs text-muted">{t('wizard.missedCutoff', { date: dayLong(d.defaultDate) })}</p>
        ) : null
      ) : (
        <p className="mt-2 text-xs text-muted">{t('wizard.noSchedule')}</p>
      )}
      <details className="mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-primary">{t('wizard.otherDate')}</summary>
        <Field label={t('wizard.deliveryDate')} htmlFor="ord-delivery-date" className="mt-2">
          <Input
            id="ord-delivery-date"
            type="date"
            data-testid="order-delivery-date"
            value={value}
            min={d.today}
            required
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-12 text-base"
          />
        </Field>
      </details>
    </div>
  );
}
