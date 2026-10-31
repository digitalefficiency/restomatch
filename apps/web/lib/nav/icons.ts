import {
  BarChart3,
  Boxes,
  ChefHat,
  ClipboardList,
  FileDown,
  FileSearch,
  FileSignature,
  FileText,
  HandCoins,
  Home,
  Inbox,
  Mail,
  Network,
  PackageCheck,
  Plug,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icons per registry key. Kept apart from the registry so `lib/roles.ts` (and
 * the edge middleware that imports it) never pulls in the icon set.
 */
export const ROUTE_ICONS: Record<string, LucideIcon> = {
  home: Home,
  approvals: Inbox,
  payRun: Wallet,
  inbox: Mail,
  invoices: Receipt,
  invoiceDetail: Receipt,
  leaks: BarChart3,
  leaksProof: FileSearch,
  claims: HandCoins,
  recovery: HandCoins,
  ledger: ScrollText,
  exports: FileDown,
  monthlyReport: FileText,
  ask: Sparkles,
  orders: ShoppingCart,
  receiving: PackageCheck,
  suppliers: Truck,
  catalog: Boxes,
  contracts: FileSignature,
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
