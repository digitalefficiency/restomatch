import type { Shape } from '../../../../translate';
import type { he } from '../../../ingest/he';

/** ingest — ti overlay (Tigrinya): the receiver-PWA strings only (pwa.*). Machine-drafted; needs the native-speaker pass. */
export const ingest: Shape<Pick<typeof he, 'pwa'>> = {
  pwa: {
    offlineTitle: 'ምትእስሳር ኢንተርነት የለን',
    offlineBody: 'ስእሊ ምልዓል ክትቅጽሉ ትኽእሉ ኢኹም። ስእልታት ኣብ ተሌፎን ይዕቀባ፡ ምትእስሳር ምስ ተመልሰ ባዕለን ይለኣኻ።',
    queued: 'ንምልኣኽ ዝጽበያ ስእልታት: {count}',
    queuedOne: 'ሓንቲ ስእሊ ንምልኣኽ ትጽበ ኣላ',
    syncing: 'ዝተዓቀባ ስእልታት ይለኣኻ ኣለዋ…',
    synced: 'ኩለን ስእልታት ተላኢኸን',
    syncFailed: 'ምልኣኽ ኣይተዓወተን፡ ድሕሪ ቁሩብ ደጊምና ክንፍትን ኢና',
    savedOffline: 'ስእሊ ኣብ ተሌፎን ተዓቂባ ኣላ፡ ምትእስሳር ምስ ተመልሰ ክትለኣኽ እያ',
    install: 'ናይ ምቕባል ኣፕ ኣእትዉ',
    installHint: 'ኣብ ቀንዲ ስክሪን ዝርከብ መቓረቢ — ብቐጥታ ናብ ምቕባል ኣቕሓ ይኸፍት።',
    installed: 'ኣገባብ ኣፕ',
  },
};
