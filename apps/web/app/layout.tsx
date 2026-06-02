import type { Metadata } from 'next';
import { TrpcProvider } from '@/lib/trpc/client';
import './globals.css';

export const metadata: Metadata = {
  title: 'RestoMatch',
  description: 'התאמת חשבוניות, הזמנות וקבלת סחורה למסעדות',
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="antialiased font-sans text-stone-900">
        <TrpcProvider>{props.children}</TrpcProvider>
      </body>
    </html>
  );
}
