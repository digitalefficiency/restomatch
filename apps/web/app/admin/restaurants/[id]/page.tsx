import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerCaller } from '@/lib/trpc/server';
import { AssignPlanForm } from './AssignPlanForm';

const ROLE_LABEL: Record<string, string> = {
  owner: 'בעלים',
  manager: 'מנהל',
  receiver: 'קבלן',
  bookkeeper: 'הנה"ח',
  chef: 'שף',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminRestaurantDetail({ params }: PageProps) {
  const { id } = await params;
  const caller = await createServerCaller();
  let data;
  try {
    data = await caller.admin.getRestaurant({ restaurantId: id });
  } catch {
    notFound();
  }
  const { restaurant, subscription, members } = data;

  return (
    <div>
      <Link href="/admin" className="text-sm text-subtle transition-colors hover:text-ink">
        ← כל המסעדות
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold text-ink">{restaurant.name}</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="relative overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-card">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-wider text-subtle">מנוי</h2>
          {subscription ? (
            <dl className="space-y-2 text-sm">
              <Row label="תוכנית" value={subscription.planKey} />
              <Row label="סטטוס" value={subscription.status} />
              <Row
                label="הרחבות"
                value={
                  JSON.stringify(subscription.overrides) === '{}'
                    ? '—'
                    : JSON.stringify(subscription.overrides)
                }
              />
            </dl>
          ) : (
            <p className="text-sm text-subtle">ללא מנוי — ניסיון משתמע (פיצ׳רים מלאים, נפח נמוך)</p>
          )}
          <div className="mt-5 border-t border-line pt-5">
            <AssignPlanForm
              restaurantId={restaurant.id}
              currentPlan={subscription?.planKey ?? null}
            />
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-wider text-subtle">
            משתמשים (<span className="tabular-nums">{members.length}</span>)
          </h2>
          <ul className="space-y-2 text-sm">
            {members.map((m) => (
              <li key={m.userId} className="flex justify-between gap-4">
                <span className="text-ink">{m.email}</span>
                <span className="text-subtle">{ROLE_LABEL[m.role] ?? m.role}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-subtle">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
