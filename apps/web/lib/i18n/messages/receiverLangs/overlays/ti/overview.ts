// Machine translation — pending native review (W1-06 follow-up).
import type { Shape } from '../../../../translate';
import type { OverviewReceiverSlice } from '../overview';

/** overview (receiver slice) — ti overlay (Tigrinya). */
export const overview: Shape<OverviewReceiverSlice> = {
  homeTitle: { receiver: 'ናይ ሎሚ ጽዕነታት' },
  homeSubtitle: { receiver: 'ዝቕጽል መኪና ኣብ ላዕሊ፣ ድሕሪኡ ኩሉ እቲ ዝተረፈ።' },
  board: {
    summary: 'ሎሚ: {total} ጽዕነታት · {received} ተቐቢልና · {late} ደንጒዮም',
    next: 'ዝቕጽል መኪና',
    groups: {
      late: 'ደንጒዮም',
      now: 'ሕጂ / ዝቕጽል',
      later: 'ጸኒሑ ሎሚ',
      undated: 'ዕለት የብሉን',
      received: 'ተቐቢልና',
    },
    cta: {
      start: 'ምቕባል ጀምሩ',
      continue: 'ምቕባል ቀጽሉ',
      received: 'ተቐቢሉ ✓',
      partial: 'ብኸፊል ተቐቢሉ ✓',
    },
    state: {
      inProgress: 'ይቕበል ኣሎ',
      late: 'ደንጒዩ',
      lateSince: 'ኣብ {date} ይጽበ ነይሩ',
    },
    items: '{count} ኣቕሑ',
    noDate: 'ዕለት ምብጻሕ የብሉን',
    closedAt: 'ኣብ {time} ተዓጽዩ',
    noPo: {
      title: 'ፋክቱራ ብዘይ ትእዛዝ',
      hint: 'ኣቕራቢ ብዘይ ትእዛዝ መጺኡ? ኣመሓዳሪ ፈረቓ ትእዛዝ ክኸፍት ሕተቱ፣ መኪና ድማ ንምቕባል ኣብዚ ክትርኣ እያ።',
    },
    empty: {
      title: 'ሎሚ ዝጽበ ጽዕነት የለን',
      hint: 'ምስ ዕለት ምብጻሕ ትእዛዝ ናብ ኣቕራቢ ምስ ተላእከ፣ መኪና ኣብዚ ክትርኣ እያ።',
    },
    receipt: {
      title: 'ምቕባል ካብ {supplier}',
      readOnly: 'ምቕባል ተዓጽዩ — ንምንባብ ጥራይ',
      back: 'ናብ ሰሌዳ ጽዕነታት ተመለሱ',
      product: 'ኣቕሓ',
      ordered: 'ዝተኣዘዘ',
      received: 'ዝተቐበልናዮ',
      rejected: 'ተነጺጉ',
      notFound: 'ምቕባል ኣይተረኽበን',
      followUp: {
        cta: 'ተወሳኺ ጽዕነት መጺኡ — ምቕባል ኣማልኡ',
        hint: 'ሕጂ ዝመጸ ንምቑጻር ምቕባል ደጊሙ ይኽፈት። ምኽፋቱ ኣብ መዝገብ ይጽሓፍ።',
        failed: 'ምቕባል ክንከፍቶ ኣይከኣልናን። ደጊምኩም ፈትኑ።',
      },
    },
  },
};
