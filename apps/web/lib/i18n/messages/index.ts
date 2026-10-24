/**
 * Registry of every message namespace. Import a namespace directly from its
 * folder in components (keeps client bundles small); this barrel exists for
 * the parity test and tooling. Add a new namespace here when you create one.
 */
import { common } from './common';
import { admin } from './admin';
import { approvals } from './approvals';
import { auth } from './auth';
import { catalog } from './catalog';
import { chain } from './chain';
import { components } from './components';
import { contracts } from './contracts';
import { supplierConfirm } from './supplierConfirm';
import { dockPrice } from './dockPrice';
import { emails } from './emails';
import { accounting } from './accounting';
import { ingest } from './ingest';
import { integrations } from './integrations';
import { invoices } from './invoices';
import { landing } from './landing';
import { leaks } from './leaks';
import { marketing } from './marketing';
import { nav } from './nav';
import { onboarding } from './onboarding';
import { orders } from './orders';
import { overview } from './overview';
import { payRun } from './payRun';
import { products } from './products';
import { receiving } from './receiving';
import { leakProof } from './leakProof';
import { recovery } from './recovery';
import { receiverLangs } from './receiverLangs';
import { ask } from './ask';
import { recipes } from './recipes';
import { inventory } from './inventory';
import { scans } from './scans';
import { settings } from './settings';
import { showcase } from './showcase';
import { suppliers } from './suppliers';
import { team } from './team';
import { views } from './views';
import { leakCheck } from './leakCheck';
import { growth } from './growth';
import { vat } from './vat';

export const ALL_NAMESPACES = [
  common,
  admin,
  approvals,
  auth,
  catalog,
  chain,
  components,
  contracts,
  supplierConfirm,
  dockPrice,
  emails,
  accounting,
  ingest,
  integrations,
  invoices,
  landing,
  leaks,
  marketing,
  nav,
  onboarding,
  orders,
  overview,
  payRun,
  products,
  receiving,
  leakProof,
  recovery,
  receiverLangs,
  ask,
  recipes,
  inventory,
  scans,
  settings,
  showcase,
  suppliers,
  team,
  views,
  leakCheck,
  growth,
  vat,
] as const;

export { common, admin, approvals, auth, catalog, chain, components, contracts, supplierConfirm, dockPrice, emails, accounting, ingest, integrations, invoices, landing, leakProof, leaks, marketing, nav, onboarding, orders, overview, products, receiving, recovery, receiverLangs, ask, recipes, inventory, scans, settings, showcase, suppliers, team, views, leakCheck, growth, vat };
