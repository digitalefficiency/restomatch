'use client';

import { useReducer } from 'react';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { receiving } from '@/lib/i18n/messages/receiving';
import { AdjustQuantities } from './_steps/AdjustQuantities';
import { Confirmed } from './_steps/Confirmed';
import { InvoiceScan } from './_steps/InvoiceScan';
import { Processing } from './_steps/Processing';
import { Reconciliation } from './_steps/Reconciliation';
import { SupplierSelect } from './_steps/SupplierSelect';
import { initialState, reducer, type WizardStep } from './_state';
import { ShowcaseEndCard } from '../_components/ShowcaseEndCard';

const STEP_ORDER: WizardStep[] = [
  'SELECT_SUPPLIER',
  'SCAN_INVOICE',
  'PROCESSING',
  'RECONCILIATION_REVIEW',
  'ADJUST_QUANTITIES',
  'CONFIRMED',
];

export default function ReceiverWizard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stepIndex = STEP_ORDER.indexOf(state.step);
  const locale = useLocale();
  const dir = useDir();
  const t = useT(receiving);
  const supplier = state.selectedSupplier;
  const supplierLabel =
    supplier ? (locale === 'en' && supplier.supplierNameEn ? supplier.supplierNameEn : supplier.supplierName) : '';

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 min-h-[calc(100dvh-72px)]">
      {/* The language switch lives in the showcase header only (mkt-32). */}
      <p className="mb-6 text-sm text-muted" dir={dir}>
        {t('demo.banner')}
      </p>

      {/* Progress bar */}
      <div className="mb-10 flex items-center gap-2" dir={dir}>
        {STEP_ORDER.slice(0, 5).map((_, i) => {
          const isDone = i < stepIndex;
          const isCurrent = i === stepIndex;
          return (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all ${
                isDone || isCurrent ? 'flow-stream' : 'bg-surface-2'
              }`}
            />
          );
        })}
      </div>

      {/* Step body */}
      {state.step === 'SELECT_SUPPLIER' ? (
        <SupplierSelect
          selected={state.selectedSupplier}
          onSelect={(s) => dispatch({ type: 'SELECT_SUPPLIER', supplier: s })}
          onContinue={() => dispatch({ type: 'CONTINUE_TO_SCAN' })}
        />
      ) : null}

      {state.step === 'SCAN_INVOICE' && state.selectedSupplier ? (
        <InvoiceScan
          supplierName={supplierLabel}
          image={state.image}
          onCapture={(image) => dispatch({ type: 'CAPTURE_IMAGE', image })}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      ) : null}

      {state.step === 'PROCESSING' && state.selectedSupplier ? (
        <Processing
          supplierId={state.selectedSupplier.supplierId}
          imageUrl={state.image?.publicUrl}
          onComplete={(result) => dispatch({ type: 'PROCESSING_COMPLETE', result })}
        />
      ) : null}

      {state.step === 'RECONCILIATION_REVIEW' && state.reconciliation ? (
        <Reconciliation
          result={state.reconciliation}
          onQuickConfirm={() => dispatch({ type: 'QUICK_CONFIRM' })}
          onContinueAdjust={() => dispatch({ type: 'CONTINUE_TO_ADJUST' })}
          onRetake={() => dispatch({ type: 'RETAKE' })}
        />
      ) : null}

      {state.step === 'ADJUST_QUANTITIES' && state.reconciliation ? (
        <AdjustQuantities
          result={state.reconciliation}
          marks={state.marks}
          onUpdateMark={(lineKey, patch) =>
            dispatch({ type: 'UPDATE_MARK', lineKey, patch })
          }
          onSubmit={() => dispatch({ type: 'SUBMIT_RECEIPT' })}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      ) : null}

      {state.step === 'CONFIRMED' ? (
        <Confirmed
          supplierName={supplierLabel}
          result={state.reconciliation}
          confirmedAt={state.confirmedAt}
          capturedImage={state.image}
          onReset={() => dispatch({ type: 'RESET' })}
        />
      ) : null}
      {state.step === 'CONFIRMED' ? (
        <ShowcaseEndCard kind="receiver" amountIls={state.reconciliation?.summary.headlineDelta ?? null} />
      ) : null}
    </main>
  );
}
