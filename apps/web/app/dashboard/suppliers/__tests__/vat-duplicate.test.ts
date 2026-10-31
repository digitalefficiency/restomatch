import { describe, expect, it } from 'vitest';
import { formatPercent } from '@/lib/i18n/format';
import {
  duplicateKindOf,
  emptyForm,
  toCreateInput,
  toUpdatePatch,
  vatChoiceOf,
  vatRateOfChoice,
} from '../form-logic';

describe('supplier VAT select', () => {
  it('maps the stored NUMERIC string to the select value', () => {
    expect(vatChoiceOf(null)).toBe('default');
    expect(vatChoiceOf('0.0000')).toBe('0');
    expect(vatChoiceOf('0.1800')).toBe('0.18');
    expect(vatChoiceOf('0.1700')).toBe('other');
  });

  it('maps the select value to the API rate', () => {
    expect(vatRateOfChoice('0')).toBe(0);
    expect(vatRateOfChoice('0.18')).toBe(0.18);
    expect(vatRateOfChoice('default')).toBeNull();
    expect(vatRateOfChoice('other')).toBeUndefined();
  });

  it('create sends 0 for produce and omits the default', () => {
    expect(toCreateInput({ ...emptyForm, name: 'X', vatRate: '0' }).vatRate).toBe(0);
    expect(toCreateInput({ ...emptyForm, name: 'X' })).not.toHaveProperty('vatRate');
  });

  it('update clears to the default with null and keeps an unsettable stored rate untouched', () => {
    expect(toUpdatePatch({ ...emptyForm, name: 'X' }).vatRate).toBeNull();
    expect(toUpdatePatch({ ...emptyForm, name: 'X', vatRate: '0.18' }).vatRate).toBe(0.18);
    expect(toUpdatePatch({ ...emptyForm, name: 'X', vatRate: 'other' })).not.toHaveProperty('vatRate');
  });

  it('shows the rate with he-IL numerals', () => {
    expect(formatPercent(0, 'he', 2)).toBe('0%');
    expect(formatPercent(Number('0.1800'), 'he', 2)).toBe('18%');
  });
});

describe('duplicate refusal', () => {
  it('CONFLICT is the ח.פ. refusal, PRECONDITION_FAILED the name warning', () => {
    expect(duplicateKindOf('CONFLICT')).toBe('businessId');
    expect(duplicateKindOf('PRECONDITION_FAILED')).toBe('name');
    expect(duplicateKindOf('BAD_REQUEST')).toBeNull();
    expect(duplicateKindOf(undefined)).toBeNull();
  });
});
