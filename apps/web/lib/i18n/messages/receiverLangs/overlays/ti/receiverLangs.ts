import type { Shape } from '../../../../translate';
import type { he } from '../../he';

/** receiverLangs — ti overlay (Tigrinya). */
export const receiverLangs: Shape<typeof he> = {
  picker: {
    label: 'ቋንቋ',
    title: 'ቋንቋ ኣፕሊኬሽን ምረጹ',
    hint: 'ቋንቋታት ተቐበልቲ ኣቕሓ: ዓረብኛ፡ ሩስኛ፡ ታይኛ፡ ትግርኛ። ካልኦት ገጻት ብእንግሊዝኛ ይርኣዩ።',
  },
  lines: {
    original: 'ብመበቆሉ',
    machine: 'ትርጉም ማሽን — ምስ ፋቱራ ኣነጻጽሩ',
    untranslated: 'ትርጉም የለን — ብመበቆል ቋንቋ ይርአ',
  },
};
