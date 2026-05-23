export default function CheckEmailPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8 text-center">
        <div className="text-4xl mb-4">✉️</div>
        <h1 className="text-2xl font-bold mb-2 text-slate-900">בדוק את המייל שלך</h1>
        <p className="text-sm text-slate-500">
          שלחנו לך קישור התחברות. לחץ עליו כדי להיכנס למערכת. הקישור תקף ל-24 שעות.
        </p>
        <p className="mt-6 text-xs text-slate-500">
          ב-development — חפש בשורות log של השרת תחת{' '}
          <code className="text-accent">──── MAGIC LINK ────</code>.
        </p>
      </div>
    </main>
  );
}
