'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, FileDown, Inbox, LayoutDashboard, Truck } from 'lucide-react';
import { cn } from '@/lib/components';

const LINKS = [
  { href: '/dashboard', label: 'סקירה', icon: LayoutDashboard },
  { href: '/dashboard/approvals', label: 'תור אישורים', icon: Inbox },
  { href: '/dashboard/leaks', label: 'בלש דליפות', icon: BarChart3 },
  { href: '/dashboard/suppliers', label: 'ספקים', icon: Truck },
  { href: '/dashboard/exports', label: 'ייצוא', icon: FileDown },
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
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-stone-600 hover:bg-stone-100 hover:text-ink',
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
