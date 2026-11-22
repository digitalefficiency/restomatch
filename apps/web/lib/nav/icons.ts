import {
  Accessibility,
  BadgeCheck,
  Banknote,
  BookOpenText,
  Building2,
  CalendarCheck,
  ChartSpline,
  ChefHat,
  CircleHelp,
  ClipboardList,
  Coins,
  Droplet,
  FileChartColumn,
  FileDown,
  FileSearch,
  FileStack,
  FileText,
  HandCoins,
  Handshake,
  House,
  Inbox,
  MessageCircle,
  Network,
  PackageCheck,
  Plug,
  ReceiptText,
  Search,
  Settings,
  ShoppingBasket,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Tags,
  Truck,
  Users,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { GroupKey } from './types';

/**
 * Icons per registry key (sidebar spec §3, §4.1; lucide-react 0.469 canonical
 * names). Kept apart from the registry so `lib/roles.ts` (and the edge
 * middleware that imports it) never pulls in the icon set.
 */
export const ROUTE_ICONS: Record<string, LucideIcon> = {
  home: House,
  /** לטיפולי: the shell's own top item (lib/nav/queue.ts). */
  queue: Inbox,
  approvals: BadgeCheck,
  payRun: Banknote,
  /** §4.1: חשבוניות נכנסות is ReceiptText; the invoices register (a row the spec folds away) takes FileStack. */
  inbox: ReceiptText,
  invoices: FileStack,
  invoiceDetail: FileStack,
  leaks: Droplet,
  leaksProof: FileSearch,
  claims: HandCoins,
  recovery: Coins,
  ledger: BookOpenText,
  exports: FileDown,
  close: CalendarCheck,
  monthlyReport: FileChartColumn,
  ask: Sparkles,
  orders: ShoppingCart,
  receiving: PackageCheck,
  suppliers: Truck,
  catalog: Tags,
  contracts: Handshake,
  recipes: ChefHat,
  inventory: ClipboardList,
  chain: Network,
  branches: Store,
  team: Users,
  integrations: Plug,
  settings: Settings,
};

export function iconFor(key: string): LucideIcon {
  return ROUTE_ICONS[key] ?? FileText;
}

/** Group glyphs: 16 px in a panel header, 20 px on a rail tile (spec §1.1, §4.1). */
export const GROUP_ICONS: Record<GroupKey | 'favourites', LucideIcon> = {
  top: House,
  money: Wallet,
  leaks: ChartSpline,
  procure: ShoppingBasket,
  kitchen: Utensils,
  chain: Building2,
  admin: SlidersHorizontal,
  favourites: Star,
};

/** Shell utility glyphs (help row, search tile). */
export const UTILITY_ICONS = {
  search: Search,
  help: CircleHelp,
  accessibility: Accessibility,
  contact: MessageCircle,
} as const satisfies Record<string, LucideIcon>;

/**
 * Optical size factor per icon key (spec §3: the glyph is scaled inside its box
 * and its stroke divided by the same factor, so every icon reads the same size).
 */
export const OPTICAL_SCALE: Readonly<Record<string, number>> = {
  payRun: 1.1,
  integrations: 1.08,
  leaks: 1.06,
  catalog: 1.04,
};

/** Icons that read right to left (lists, exits) and so mirror in RTL (spec §3). */
export const MIRRORED_ICONS: ReadonlySet<string> = new Set(['inventory']);
