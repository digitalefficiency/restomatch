'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = trpc.onboarding.createRestaurant.useMutation({
    onSuccess: () => {
      router.refresh();
      router.push('/dashboard');
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate({
          name,
          businessId: businessId.trim() || undefined,
        });
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="name" className="block text-sm text-neutral-300 mb-1.5">
          שם המסעדה <span className="text-danger">*</span>
        </label>
        <input
          id="name"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="כפר הזיתים"
          className="w-full rounded-md bg-bg border border-neutral-700 px-3 py-2 text-white outline-none focus:border-primary"
        />
      </div>

      <div>
        <label htmlFor="businessId" className="block text-sm text-neutral-300 mb-1.5">
          ח״פ / עוסק מורשה <span className="text-neutral-500">(לא חובה)</span>
        </label>
        <input
          id="businessId"
          inputMode="numeric"
          pattern="\d{9,12}"
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          placeholder="514778123"
          className="w-full rounded-md bg-bg border border-neutral-700 px-3 py-2 text-white outline-none focus:border-primary"
        />
      </div>

      {error ? (
        <div className="rounded-md bg-danger/10 border border-danger/30 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={create.isPending}
        className="w-full bg-primary hover:bg-primary-hover disabled:opacity-50 rounded-md py-2.5 font-medium transition-colors"
      >
        {create.isPending ? 'יוצר…' : 'צור מסעדה והמשך'}
      </button>
    </form>
  );
}
