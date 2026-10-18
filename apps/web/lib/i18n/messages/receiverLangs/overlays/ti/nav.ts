import type { Shape } from '../../../../translate';
import type { he } from '../../../nav/he';

/** nav — ti overlay (Tigrinya). */
export const nav: Shape<typeof he> = {
  mainLabel: 'ቀንዲ መዘዋወሪ',
  mobileLabel: 'ቅልጡፍ መዘዋወሪ',
  skipToContent: 'ናብ ትሕዝቶ ሕለፉ',
  links: {
    overview: 'ሓፈሻዊ ትርኢት',
    receiving: 'ምቕባል ኣቕሓ',
    approvals: 'ምጽዳቕ',
    leaks: 'መርማሪ ክሳራ',
    suppliers: 'ኣቕረብቲ',
    catalog: 'ካታሎግ',
    orders: 'ትእዛዛት',
    exports: 'ምውጻእ ፋይላት',
    team: 'ጉጅለ',
    settings: 'ቅጥዕታት',
  },
  groups: {
    operations: 'ዕለታዊ ስራሕ',
    purchasing: 'ዕድጊ',
    admin: 'ምምሕዳር',
  },
  menu: {
    open: 'ሜኑ ክፈቱ',
    close: 'ሜኑ ዕጸዉ',
    more: 'ተወሳኺ',
    account: 'ኣካውንት',
  },
  signOut: 'ካብ ኣካውንት ውጹ',
  search: {
    placeholder: 'ኣቕረብቲ፡ ኣቕሑት፡ ፋቱራታት ድለዩ…',
    shortPlaceholder: 'ድለዩ…',
    label: 'ሓፈሻዊ ምድላይ',
    searching: 'ይድለ ኣሎ…',
    noResults: 'ውጽኢት የለን',
    minChars: 'እንተወሓደ 2 ፊደላት ጽሓፉ',
    error: 'ምድላይ ኣይሰለጠን። በጃኹም እንደገና ፈትኑ።',
    hint: 'ቀስትታት ንምንቅስቓስ · Enter ንምኽፋት · Esc ንምዕጻው',
    groups: {
      suppliers: 'ኣቕረብቲ',
      products: 'ኣቕሑት',
      invoices: 'ፋቱራታት',
    },
    noInvoiceNumber: 'ቁጽሪ የብሉን',
  },
  worker: {
    title: 'ናይ ምስራሕ ሲስተም ሕጂ ኣይሰርሕን ዘሎ።',
    body: 'እትሰዱዎም ፋቱራታት ይዕቀቡ፡ ሲስተም ምስ ተመለሰ ድማ ክንበቡን ክነጻጸሩን እዮም።',
    lastBeat: 'መወዳእታ ምልክት ቅድሚ {minutes} ደቒቕ።',
    ownerNotified: 'ወናኒ ተሓቢሩ ኣሎ።',
  },
  loading: 'ይጽዓን ኣሎ',
};
