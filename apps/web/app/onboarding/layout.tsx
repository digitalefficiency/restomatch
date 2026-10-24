import { TrpcProvider } from '@/lib/trpc/client';

/** Onboarding's form calls tRPC; the root layout no longer provides it app-wide. */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <TrpcProvider>{children}</TrpcProvider>;
}
