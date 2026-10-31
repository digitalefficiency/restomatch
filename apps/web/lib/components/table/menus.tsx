'use client';

import { useState } from 'react';
import { Columns3, Download, Rows3 } from 'lucide-react';
import { useLocale } from '@/lib/i18n/client';
import { cn } from '../cn';
import { deskCopy } from './copy';
import { ToolbarPopover } from './Popover';
import type { Density } from './types';
import { DENSITIES } from './types';

const ITEM =
  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-info';

/** Show/hide columns. The identity column is never offered (it is the row's name). */
export function ColumnsMenu({
  columns,
  visible,
  onChange,
}: {
  columns: { id: string; header: string; hideable?: boolean; identity?: boolean }[];
  visible: string[];
  onChange: (visible: string[]) => void;
}) {
  const copy = deskCopy(useLocale());
  const offered = columns.filter((c) => !c.identity && c.hideable !== false);
  return (
    <ToolbarPopover label={copy.columns} icon={<Columns3 aria-hidden className="h-4 w-4" />}>
      {() => (
        <fieldset>
          <legend className="sr-only">{copy.columns}</legend>
          {offered.map((c) => {
            const on = visible.includes(c.id);
            return (
              <label key={c.id} className={cn(ITEM, 'cursor-pointer')}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    onChange(
                      on
                        ? visible.filter((v) => v !== c.id)
                        : columns.map((x) => x.id).filter((id) => id === c.id || visible.includes(id)),
                    )
                  }
                  className="h-4 w-4 accent-primary"
                />
                {c.header}
              </label>
            );
          })}
        </fieldset>
      )}
    </ToolbarPopover>
  );
}

export function DensityMenu({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  const copy = deskCopy(useLocale());
  return (
    <ToolbarPopover label={copy.density} icon={<Rows3 aria-hidden className="h-4 w-4" />}>
      {(close) => (
        <fieldset>
          <legend className="sr-only">{copy.density}</legend>
          {DENSITIES.map((d) => (
            <label key={d} className={cn(ITEM, 'cursor-pointer')}>
              <input
                type="radio"
                name="rm-density"
                checked={value === d}
                onChange={() => {
                  onChange(d);
                  close();
                }}
                className="h-4 w-4 accent-primary"
              />
              {copy.densities[d]}
            </label>
          ))}
        </fieldset>
      )}
    </ToolbarPopover>
  );
}

/**
 * ⤓ Export (exec-desktop-17): CSV with the BOM and the period/scope/filters/
 * generated-at header rows, a copy-link of the current view (the URL carries
 * it), and print. XLSX is a wave-2 follow-up (no new dependency in wave 1).
 */
export function ExportMenu({ onCsv }: { onCsv: () => void }) {
  const copy = deskCopy(useLocale());
  const [copied, setCopied] = useState(false);
  return (
    <ToolbarPopover label={copy.export} icon={<Download aria-hidden className="h-4 w-4" />}>
      {(close) => (
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              data-export="csv"
              className={ITEM}
              onClick={() => {
                onCsv();
                close();
              }}
            >
              {copy.exportCsv}
            </button>
          </li>
          <li>
            <button
              type="button"
              data-export="link"
              className={ITEM}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* clipboard blocked — the address bar still holds the link */
                }
              }}
            >
              {copied ? copy.linkCopied : copy.copyLink}
            </button>
            <span aria-live="polite" className="sr-only">
              {copied ? copy.linkCopied : ''}
            </span>
          </li>
          <li>
            <button
              type="button"
              data-export="print"
              className={ITEM}
              onClick={() => {
                close();
                window.print();
              }}
            >
              {copy.print}
            </button>
          </li>
        </ul>
      )}
    </ToolbarPopover>
  );
}
