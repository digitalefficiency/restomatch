import type { Shape } from '../../../../translate';
import type { he } from '../../../components/he';

/** components — ti overlay (Tigrinya). */
export const components: Shape<typeof he> = {
  spinner: { loading: 'ይጽዓን ኣሎ' },
  loadMore: { label: 'ተወሳኺ ኣርእዩ' },
  breadcrumbs: { label: 'መንገዲ ገጽ' },
  toast: {
    region: 'መልእኽትታት',
    dismiss: 'መልእኽቲ ኣርሕቑ',
  },
  errors: {
    generic: 'ገለ ጌጋ ተፈጢሩ። በጃኹም ደጊምኩም ፈትኑ።',
    network: 'ናብ ሰርቨር ክበጽሕ ኣይከኣለን። ኢንተርነትኩም ኣረጋግጹ እሞ ደጊምኩም ፈትኑ።',
    forbidden: 'ነዚ ንምግባር ፍቓድ የብልኩምን።',
    notFound: 'ኣይተረኽበን — ተደምሲሱ ክኸውን ይኽእል።',
    validation: 'ገለ ቦታታት ጌጋ እዮም። በጃኹም ኣረጋግጹ እሞ ደጊምኩም ፈትኑ።',
    tooMany: 'ብዙሕ ፈተነታት። ቁሩብ ተጸበዩ እሞ ደጊምኩም ፈትኑ።',
  },
  entitlement: {
    features: {
      advanced_analytics: 'ዕሙቕ ትንተና',
      accounting_export: 'ምውጻእ ናብ ሕሳብ',
      whatsapp_alerts: 'መጠንቀቕታ WhatsApp',
      integrations: 'ምትእስሳር ምስ ካልእ ሲስተም',
    },
    compactTitle: '{feature} ንምኽፋት ኣመሓይሹ',
    compactBody: 'እዚ ኣገልግሎት ኣብ ናይ ክፍሊት ፓኬጃት ጥራይ ይርከብ።',
    compactCta: 'ፓኬጃት ርኣዩ',
    title: '{feature} ንምኽፋት ፓኬጅኩም ኣመሓይሹ',
    body: '{feature} ኣብ ናይ ክፍሊት ፓኬጃት ይርከብ። ምሉእ ተበጻሕነት ንምርካብ ኣካውንትኩም ኣመሓይሹ።',
    cta: 'ፓኬጃት ርኣዩ እሞ ኣመሓይሹ',
  },
  errorNotice: { title: 'ገለ ጌጋ ተፈጢሩ' },
  activity: {
    types: {
      invoice_received: 'ፋቱራ በጺሑ',
      invoice_matched: 'ፋቱራ ተሰማሚዑ',
      discrepancy_approved: 'ፍልልይ ጸዲቑ',
      discrepancy_rejected: 'ፍልልይ ተነጺጉ',
      alias_learned: 'ሓድሽ ስም ኣቕሓ ተማሂሩ',
      sync_completed: 'ምትእስሳር ሓበሬታ ተዛዚሙ',
      other: 'ሓድሽ ሓበሬታ',
    },
    invoiceReceivedNumbered: 'ፋቱራ {number} በጺሑ',
    consolidatedReceivedNumbered: 'ሓባራዊ ፋቱራ {number} በጺሑ',
    inclVat: '{amount} ምስ ቫት',
    matchesOrder: 'ምስ ትእዛዝን ምቕባል ኣቕሓን ይሰማማዕ',
    awaitingDeliveryNotes: 'ምስ ናይዚ ሰሙን ወረቐት ኣቕርቦት ክነጻጸር ይጽበ ኣሎ',
    invoiceMatchedNumbered: 'ፋቱራ {number} ተሰማሚዑ',
    discrepancyOne: '1 ፍልልይ',
    discrepancies: '{count} ፍልልያት',
    potentialLoss: 'ክመጽእ ዝኽእል ክሳራ {amount}',
    savings: '{amount} ተቘጢቡ',
    matchesOrderAndReceipt: 'ምስ ትእዛዝን ኣቕርቦትን ይሰማማዕ',
    awaitingMonthlyMatch: 'ምስ ናይዚ ወርሒ ወረቐት ኣቕርቦት ክነጻጸር ይጽበ ኣሎ',
    empty: 'ገና ዝኾነ ንጥፈት የለን።',
  },
};
