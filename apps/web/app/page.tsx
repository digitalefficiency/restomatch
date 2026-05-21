export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-right">
        <h1 className="text-4xl font-bold mb-4 text-white">RestoMatch</h1>
        <p className="text-lg text-neutral-400 mb-8">
          התאמת חשבוניות, הזמנות וקבלת סחורה למסעדות — סקפלד ראשוני.
        </p>
        <div className="rounded-lg border border-neutral-800 bg-surface p-6">
          <h2 className="text-xl font-semibold mb-3">צעדים הבאים</h2>
          <ul className="space-y-2 text-neutral-300 list-disc list-inside">
            <li>הקמת בסיס נתונים Postgres עם pgvector (Neon מומלץ)</li>
            <li>הרצת <code className="text-accent">pnpm db:generate</code> ו-<code className="text-accent">db:migrate</code></li>
            <li>חיבור Auth.js + הגדרת ראשון restaurant + owner</li>
            <li>מימוש MarketMan adapter ב-<code className="text-accent">packages/procurement</code></li>
          </ul>
        </div>
      </div>
    </main>
  );
}
