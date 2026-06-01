'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button, Field, Input } from '@/lib/components';

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
      <Field
        htmlFor="name"
        label={
          <>
            שם המסעדה <span className="text-danger">*</span>
          </>
        }
      >
        <Input
          id="name"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="כפר הזיתים"
        />
      </Field>

      <Field
        htmlFor="businessId"
        label={
          <>
            ח״פ / עוסק מורשה <span className="text-slate-500">(לא חובה)</span>
          </>
        }
      >
        <Input
          id="businessId"
          inputMode="numeric"
          pattern="\d{9,12}"
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          placeholder="514778123"
        />
      </Field>

      {error ? (
        <div
          role="alert"
          className="rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <Button type="submit" className="w-full" loading={create.isPending}>
        צור מסעדה והמשך
      </Button>
    </form>
  );
}
