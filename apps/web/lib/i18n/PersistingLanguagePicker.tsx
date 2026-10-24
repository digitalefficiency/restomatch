'use client';

import { trpc } from '@/lib/trpc/client';
import { LanguagePicker } from './LanguagePicker';

/** Dashboard language picker: also saves the choice as the member's language. Needs a TrpcProvider. */
export function PersistingLanguagePicker({ className }: { className?: string }) {
  const save = trpc.receiverLangs.setMyLocale.useMutation();
  return <LanguagePicker className={className} onSave={(locale) => save.mutateAsync({ locale })} />;
}
