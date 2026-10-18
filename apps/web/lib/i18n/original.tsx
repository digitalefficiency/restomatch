/**
 * Props for user/supplier DATA rendered as written (restaurant, people,
 * category, supplier names, free-text terms). When the value is Hebrew it is
 * marked `lang="he"` + `dir="auto"`, so screen readers pronounce it as Hebrew
 * and it lays out right-to-left inside English (LTR) screens — and the English
 * i18n sweep (e2e/i18n-sweep.spec.ts) knows it is an intended original, not an
 * untranslated UI string. Non-Hebrew values get no extra props.
 */
const HEBREW = /[֐-׿]/;

export function originalProps(text: string | null | undefined): { lang?: 'he'; dir?: 'auto' } {
  return text && HEBREW.test(text) ? { lang: 'he', dir: 'auto' } : {};
}

/**
 * A translated sentence that contains one data value (e.g. `From: {restaurant}`):
 * renders the sentence with just that value wrapped as an original.
 *   <WithOriginal text={t('claims.from', { restaurant })} value={restaurant} />
 */
export function WithOriginal({ text, value }: { text: string; value: string | null | undefined }) {
  const props = originalProps(value);
  if (!value || !props.lang) return <>{text}</>;
  const i = text.indexOf(value);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span {...props}>{value}</span>
      {text.slice(i + value.length)}
    </>
  );
}
