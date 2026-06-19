'use client';

import { useReducer } from 'react';
import { AdjustQuantities } from './_steps/AdjustQuantities';
import { Confirmed } from './_steps/Confirmed';
import { InvoiceScan } from './_steps/InvoiceScan';
import { Processing } from './_steps/Processing';
import { Reconciliation } from './_steps/Reconciliation';
import { SupplierSelect } from './_steps/SupplierSelect';
import { initialState, reducer, type WizardStep } from './_state';

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

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 min-h-[calc(100dvh-72px)]">
      {/* Progress bar */}
      <div className="mb-10 flex items-center gap-2" dir="rtl">
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
          supplierName={state.selectedSupplier.supplierName}
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
          supplierName={state.selectedSupplier?.supplierName ?? ''}
          result={state.reconciliation}
          confirmedAt={state.confirmedAt}
          capturedImage={state.image}
          onReset={() => dispatch({ type: 'RESET' })}
        />
      ) : null}
    </main>
  );
}
