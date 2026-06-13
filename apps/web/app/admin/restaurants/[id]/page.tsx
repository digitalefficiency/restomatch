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
      <Link href="/admin" className="text-sm text-stone-400 hover:text-stone-900">
        ← כל המסעדות
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold text-stone-900">{restaurant.name}</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-stone-500">מנוי</h2>
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
            <p className="text-sm text-stone-400">ללא מנוי — ניסיון משתמע (פיצ׳רים מלאים, נפח נמוך)</p>
          )}
          <div className="mt-5 border-t border-stone-100 pt-5">
            <AssignPlanForm
              restaurantId={restaurant.id}
              currentPlan={subscription?.planKey ?? null}
            />
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-stone-500">משתמשים ({members.length})</h2>
          <ul className="space-y-2 text-sm">
            {members.map((m) => (
              <li key={m.userId} className="flex justify-between">
                <span className="text-stone-700">{m.email}</span>
                <span className="text-stone-400">{ROLE_LABEL[m.role] ?? m.role}</span>
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
      <dt className="text-stone-400">{label}</dt>
      <dd className="font-medium text-stone-800">{value}</dd>
    </div>
  );
}
