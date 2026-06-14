import type { Metadata } from 'next';
import { Heebo, JetBrains_Mono } from 'next/font/google';
import { TrpcProvider } from '@/lib/trpc/client';
import './globals.css';

// Heebo drives Hebrew text + display (heavy weights for big numbers/headlines).
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-heebo',
  display: 'swap',
});

// JetBrains Mono powers money figures / KPIs (tabular, terminal feel).
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RestoMatch',
  description: 'התאמת חשבוניות, הזמנות וקבלת סחורה למסעדות',
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <TrpcProvider>{props.children}</TrpcProvider>
      </body>
    </html>
  );
}
