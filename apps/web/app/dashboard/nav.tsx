'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  FileDown,
  Inbox,
  LayoutDashboard,
  PackageCheck,
  Settings,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { cn } from '@/lib/components';
import { canSeeRoute } from '@/lib/roles';

const LINKS = [
  { href: '/dashboard', label: 'סקירה', icon: LayoutDashboard },
  { href: '/dashboard/receiving', label: 'קליטת סחורה', icon: PackageCheck },
  { href: '/dashboard/approvals', label: 'תור אישורים', icon: Inbox },
  { href: '/dashboard/leaks', label: 'בלש דליפות', icon: BarChart3 },
  { href: '/dashboard/suppliers', label: 'ספקים', icon: Truck },
  { href: '/dashboard/catalog', label: 'קטלוג', icon: Boxes },
  { href: '/dashboard/orders', label: 'הזמנות', icon: ShoppingCart },
  { href: '/dashboard/exports', label: 'ייצוא', icon: FileDown },
  { href: '/dashboard/team', label: 'צוות', icon: Users },
  { href: '/dashboard/settings', label: 'הגדרות', icon: Settings },
];

export function DashboardNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm" aria-label="ניווט ראשי">
      {LINKS.filter(({ href }) => canSeeRoute(role, href)).map(({ href, label, icon: Icon }) => {
        const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
              active
                ? 'bg-primary/12 font-semibold text-primary ring-1 ring-primary/25'
                : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
