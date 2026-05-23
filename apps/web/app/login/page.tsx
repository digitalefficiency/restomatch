import { signIn } from '@/auth';

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { callbackUrl, error } = await searchParams;

  async function action(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) return;
    await signIn('nodemailer', {
      email,
      redirectTo: callbackUrl ?? '/dashboard',
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
        <h1 className="text-2xl font-bold mb-2 text-slate-900">כניסה ל-RestoMatch</h1>
        <p className="text-sm text-slate-500 mb-6">
          הזן את כתובת המייל שלך — נשלח לך קישור-קסם להתחברות.
        </p>

        {error ? (
          <div className="mb-4 rounded-md bg-danger/10 border border-danger/30 px-3 py-2 text-sm text-danger">
            {error === 'Verification'
              ? 'הקישור פג תוקף או שכבר נעשה בו שימוש. נסה שוב.'
              : 'אירעה שגיאה בהתחברות. נסה שוב.'}
          </div>
        ) : null}

        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm text-slate-700 mb-1.5">
              כתובת מייל
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@restaurant.co.il"
              className="w-full rounded-md bg-white border border-slate-200 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-primary hover:bg-primary-hover rounded-md py-2.5 font-medium transition-colors"
          >
            שלח לי קישור התחברות
          </button>
        </form>

        <p className="mt-6 text-xs text-slate-500 text-center">
          ב-development הקישור יודפס ל-stdout של השרת.
        </p>
      </div>
    </main>
  );
}
