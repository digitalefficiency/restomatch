'use client';

import { createContext, useContext } from 'react';
import type { NavViewer } from './types';

export interface NavContextValue extends NavViewer {
  /** Active branch name, only for users with ≥2 memberships (titles, context lines). */
  branch: string | null;
}

const NavContext = createContext<NavContextValue | null>(null);
// Two @types/react copies in the workspace make a raw Context.Provider fail the
// JSX element check (see lib/i18n/client.tsx); cast like the other providers.
const NavCtxProvider = NavContext.Provider as unknown as React.ComponentType<{
  value: NavContextValue | null;
  children: React.ReactNode;
}>;

/**
 * The dashboard viewer (role, flags, chain) for client nav consumers:
 * breadcrumbs, PageHeader, search "מסכים", titles. Rendered by the dashboard
 * layout; outside it (`/admin`, auth pages) the hooks return null.
 */
export function NavProvider({ value, children }: { value: NavContextValue; children: React.ReactNode }) {
  return <NavCtxProvider value={value}>{children}</NavCtxProvider>;
}

export function useNavViewer(): NavContextValue | null {
  return useContext(NavContext);
}
