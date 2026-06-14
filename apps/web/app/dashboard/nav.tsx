'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, FileDown, Inbox, LayoutDashboard, Settings, Truck } from 'lucide-react';
import { cn } from '@/lib/components';

const LINKS = [
  { href: '/dashboard', label: 'סקירה', icon: LayoutDashboard },
  { href: '/dashboard/approvals', label: 'תור אישורים', icon: Inbox },
  { href: '/dashboard/leaks', label: 'בלש דליפות', icon: BarChart3 },
  { href: '/dashboard/suppliers', label: 'ספקים', icon: Truck },
  { href: '/dashboard/exports', label: 'ייצוא', icon: FileDown },
  { href: '/dashboard/settings', label: 'הגדרות', icon: Settings },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm" aria-label="ניווט ראשי">
      {LINKS.map(({ href, label, icon: Icon }) => {
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
