'use client';

import { Component, createRef, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { Icon } from '@/lib/components/icon';
import { useT } from '@/lib/i18n/client';
import { overview } from '@/lib/i18n/messages/overview';

type Props = { children: React.ReactNode; name: string };

/**
 * One card's failure stays in that card: "לא נטען · נסו שוב", never ₪0 and
 * never the whole home blanked by the root error page (command-28).
 */
class Boundary extends Component<Props, { failed: boolean; attempt: number }> {
  override state = { failed: false, attempt: 0 };
  private readonly region = createRef<HTMLDivElement>();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(`[home] section "${this.props.name}" failed`, error);
  }

  override componentDidUpdate(_: Props, prev: { failed: boolean; attempt: number }) {
    // After "נסו שוב" the button is gone: keep keyboard focus on the card it retried,
    // never dropped to <body>.
    if (this.state.attempt !== prev.attempt) this.region.current?.focus();
  }

  override render() {
    if (this.state.failed) {
      return (
        <SectionFailed
          name={this.props.name}
          // Failed again after a retry: the new retry button takes the focus.
          focusOnMount={this.state.attempt > 0}
          onRetry={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}
        />
      );
    }
    return (
      // Focus after a retry is drawn by the one global outline (DS3 SPEC §4), around the card's radius.
      <div key={this.state.attempt} ref={this.region} tabIndex={-1} className="rounded-card">
        {this.props.children}
      </div>
    );
  }
}

/** Same cast as Toast's Provider: the workspace hoists two @types/react (STATE.md). */
export const SectionBoundary = Boundary as unknown as React.ComponentType<Props>;

function SectionFailed({ name, onRetry, focusOnMount }: { name: string; onRetry: () => void; focusOnMount: boolean }) {
  const t = useT(overview);
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) retry.current?.focus();
  }, [focusOnMount]);
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div
      role="status"
      data-testid={`home-section-failed-${name}`}
      className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-line-rule bg-surface px-4 py-3 text-body-sm text-fg-secondary shadow-e1"
    >
      <span>{t('section.failed')}</span>
      <button
        ref={retry}
        type="button"
        disabled={pending}
        onClick={() =>
          start(() => {
            router.refresh();
            onRetry();
          })
        }
        className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 font-medium text-primary transition-colors duration-micro ease-standard hover:bg-surface-hover disabled:text-fg-tertiary"
      >
        <Icon as={RotateCcw} size="body-sm" />
        {t('section.retry')}
      </button>
    </div>
  );
}
