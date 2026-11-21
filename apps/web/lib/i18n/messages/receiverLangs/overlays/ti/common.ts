// Machine translation — pending native review (W1-06 follow-up).
import type { Shape } from '../../../../translate';
import type { CommonReceiverSlice } from '../common';

/** common (receiver slice: actions, states, shell resilience + screen names) — ti overlay (Tigrinya). */
export const common: Shape<CommonReceiverSlice> = {
  actions: {
    save: 'ዓቅብ',
    saving: 'ይዕቀብ ኣሎ…',
    cancel: 'ሰርዝ',
    confirm: 'ኣረጋግጽ',
    close: 'ዕጸው',
    back: 'ተመለስ',
    next: 'ዝቕጽል',
    previous: 'ዝሓለፈ',
    edit: 'ኣመዓራርያ',
    delete: 'ደምስስ',
    remove: 'ኣልግስ',
    add: 'ወስኽ',
    create: 'ፍጠር',
    search: 'ድለ',
    filter: 'ኣጻሪ',
    clear: 'ኣጽሪ',
    retry: 'ደጊምኩም ፈትኑ',
    refresh: 'ኣሐድስ',
    upload: 'ስደድ',
    download: 'ኣውርድ',
    export: 'ናብ ደገ ኣውጽእ',
    import: 'ኣእቱ',
    approve: 'ኣጽድቕ',
    reject: 'ንጸግ',
    loadMore: 'ተወሳኺ ጽዓን',
    viewAll: 'ኩሉ ርአ',
    details: 'ዝርዝር',
    continue: 'ቀጽል',
    submit: 'ልኣኽ',
    signOut: 'ውጻእ',
    backToOverview: 'ናብ ሓፈሻዊ ትዕዝብቲ ተመለስ',
    backHome: 'ናብ መበገሲ ተመለስ',
  },
  states: {
    loading: 'ይጽዓን ኣሎ…',
    empty: 'ዝርአ ሓበሬታ የለን',
    error: 'ገለ ጌጋ ተፈጢሩ',
    noResults: 'ውጽኢት ኣይተረኽበን',
    saved: 'ተዓቂቡ',
    yes: 'እወ',
    no: 'ኣይፋል',
    all: 'ኩሉ',
    none: 'የለን',
    unknown: 'ዘይፍለጥ',
    optional: 'ኣማራጺ',
    required: 'ግዴታ',
  },
  shell: {
    offline: {
      chip: 'ርክብ የለን · መርበብ ምስ ተመልሰ ከነሐድስ ኢና',
      back: 'ርክብ ተመሊሱ',
      action: 'ርክብ የለን — እቲ ተግባር ኣይተሰደደን። መርበብ ምስ ተመልሰ ደጊምኩም ፈትኑ።',
    },
    session: {
      title: 'እዋን ምእታው ኣኺሉ',
      body: 'ደጊምኩም እተዉ — ስራሕኩም ተዓቂቡ ኣሎ። ዘይተሰደደ ተግባር ካልእ ጠውቒ ይጽበ ኣሎ።',
      notSent: 'እቲ ተግባር ኣይተሰደደን · እዋን ምእታው ኣኺሉ። እተዉ እሞ ደጊምኩም ፈትኑ።',
      email: 'ኢመይል',
      password: 'ፓስዋርድ',
      submit: 'እቶ',
      submitting: 'ንኣቱ ኣለና…',
      wrong: 'ኢመይል ወይ ፓስዋርድ ጌጋ እዩ፣ ወይ ብዙሕ ፈተነታት ተገይሩ። ድሕሪ ቁሩብ ደጊምኩም ፈትኑ።',
      rate: 'ብዙሕ ፈተነታት ተገይሩ። ድሕሪ ቁሩብ ደጊምኩም ፈትኑ።',
      magicLink: 'ፓስዋርድ የብልኩምን? ናይ ምእታው ሊንክ ብኢመይል ስደዱለይ',
      magicSent: 'ናብ {email} ናይ ምእታው ሊንክ ሰዲድና። ክፈትዎ፣ ናብዚ ታብ ድማ ተመለሱ — ካብዚ ክንቕጽል ኢና።',
      magicFailed: 'ሊንክ ክንሰድድ ኣይከኣልናን። ድሕሪ ቁሩብ ደጊምኩም ፈትኑ።',
      twoFactor: 'እዚ ሕሳብ ክልተ-ደረጃ መረጋገጺ ኣለዎ። ኣብ ሓድሽ ታብ ምእታው ወድኡ እሞ ናብዚ ተመለሱ።',
      openTwoFactor: 'ኣብ ሓድሽ ታብ መረጋገጺ ወድኡ',
      checkAgain: 'ወዲአ — ቀጽል',
      stillOut: 'ገና ኣይኣቶኹምን። ምእታው ወድኡ እሞ ደጊምኩም ፈትኑ።',
      otherUserLink: 'ንስኹም ኣይኮንኩምን? ከም ካልእ ተጠቃሚ እተዉ',
      otherUser: 'ከም ካልእ ተጠቃሚ ኣቲኹም — ገጽ ደጊምና ንጽዕን ኣለና።',
      done: 'ደጊምኩም ኣቲኹም። ካብ ዝኣተኹምዎ ንቕጽል።',
      dismiss: 'ዕጸዉ',
    },
    forbidden: {
      eyebrow: '403 · ፍቓድ የለን',
      title: 'ስክሪን ‘{screen}’ ንግደኹም ክፉት ኣይኮነን',
      allowed: 'እዚ ስክሪን ን: {roles} ክፉት እዩ።',
      youAre: 'ከም {role} ኣብ {branch} ኣቲኹም።',
      requestTitle: 'ካብ ወናኒ ፍቓድ ሕተቱ',
      requestBody: 'ምስ ሊንክ ድሉው መልእኽቲ ክንሰድድ ኢና። ወናኒ ኣብ ስክሪን ጉጅለ ግደ ክቕይር ይኽእል።',
      whatsapp: 'ብዋትስኣፕ ሕተቱ',
      email: 'ብኢመይል ሕተቱ',
      requestText: 'ሰላም፣ ኣብ RestoMatch ({branch}) ናብ ስክሪን ‘{screen}’ ፍቓድ ክረክብ ይኽእል ዶ? ሊንክ: {url}',
      requestSubject: 'ሕቶ ፍቓድ ን ስክሪን ‘{screen}’',
      openIn: 'ኣብ {branch} ({role}) ክፈቱ',
      openInHint: 'ኣብ ካልእ ጨንፈር ናብዚ ስክሪን ፍቓድ ኣለኩም:',
      refreshTitle: 'ግደኹም ተሓዲሱ',
      refreshBody: 'ወናኒ ፍቓድኩም ቐይሩ። ስክሪን ‘{screen}’ ንምኽፋት ፍቓድ ኣሐድሱ።',
      refreshCta: 'ፍቓድ ኣሐድሱ',
      home: 'ናብ መበገሲ ተመለሱ',
      notMember: 'እዚ ሊንክ ናይ ፍቓድ ዘይብልኩም ጨንፈር እዩ። ወናኒ ክውስኸኩም ሕተቱ፣ ወይ ናብ መበገሲ ተመለሱ።',
      notMemberTitle: 'ናብዚ ጨንፈር ፍቓድ የብልኩምን',
    },
    notFound: {
      eyebrow: '404',
      title: 'ነዚ ገጽ ኣይረኸብናዮን',
      body: 'ተደምሲሱ፣ ሊንክ ጌጋ፣ ወይ ናይ ካልእ ጨንፈር ክኸውን ይኽእል።',
      otherBranch: 'ሊንክ ካብ ካልእ ጨንፈር እንተመጺኡ፣ ካብቲ ኣብ ላዕሊ ገጽ ዘሎ መምረጺ ጨንፈር ቐይሩ።',
      up: 'ናብ {screen} ተመለሱ',
      home: 'ናብ መበገሲ ተመለሱ',
    },
    error: {
      title: 'ነዚ ገጽ ክንጽዕኖ ኣይከኣልናን',
      body: 'ደጊምኩም ፈትኑ። እንተደጊሙ፣ ኣብዚ ዝርአ ኮድ ዓቅቡ — ጸገም ንምርካብ ይሕግዝ።',
      bodyNoCode: 'ድሕሪ ቁሩብ ደጊምኩም ፈትኑ።',
      code: 'ኮድ: {digest}',
      retry: 'ደጊምኩም ፈትኑ',
      retrying: 'ደጊምና ንጽዕን ኣለና…',
      home: 'ናብ መበገሲ ተመለሱ',
      offline: 'ምስ መርበብ ርክብ የለን፣ ስለዚ ገጽ ኣይተጻዕነን። ርክብ ምስ ተመልሰ ደጊምና ክንጽዕኖ ኢና።',
    },
    screens: {
      home: 'መበገሲ',
      receiving: 'ምቕባል ኣቕሓ',
      approvals: 'ፍቓዳት',
      payRun: 'ዙር ክፍሊታት',
      inbox: 'ዝኣተዋ ፋክቱራታት',
      invoices: 'ፋክቱራታት',
      leaks: 'ፍሰት',
      claims: 'ዝስደዱ ሕቶታት ክሬዲት',
      leakProof: 'መረጋገጺ ፍሰት',
      leakReport: 'ጸብጻብ ፍሰታት',
      recovery: 'ምክትታል ዝምለስ ₪',
      reports: 'ጸብጻባት',
      monthlyReport: 'ወርሓዊ ጸብጻብ',
      ask: 'ን RestoMatch ሕተቱ',
      suppliers: 'ኣቕረብቲ',
      ledger: 'ሕሳብ ኣቕረብቲ',
      catalog: 'ካታሎግ',
      orders: 'ትእዛዛት',
      contracts: 'ውዕላትን ዋጋታትን',
      recipes: 'ዋጋ ምግቢ',
      inventory: 'ቆጸራ ክዝና',
      exports: 'ምዕጻው ወርሒን ምውጻእን',
      integrations: 'ምትእስሳራት',
      team: 'ጉጅለ',
      settings: 'ቅጥዕታት',
      chain: 'ሓፈሻዊ ትዕዝብቲ ሰንሰለት',
      branches: 'ጨናፍር',
    },
    listSep: ', ',
    listLast: ' ከምኡውን ',
  },
  // W3-03a field components — machine translation, pending native review.
  field: {
    scan: {
      button: 'ባርኮድ ስካን', // review
      scanning: 'ካሜራ ናብ ባርኮድ ኣቕንዕዎ', // review
      cancel: 'ሰርዝ', // review
      typeInstead: 'ብኢድ ምጽሓፍ', // review
      manualLabel: 'ቁጽሪ ባርኮድ', // review
      manualHint: 'ኣብ ትሕቲ መስመራት ዘለዉ ቁጽርታት', // review
      submit: 'ኣረጋግጽ', // review
      empty: 'መጀመርታ ቁጽሪ ጽሓፉ', // review
      found: 'ተስኪኑ: {code}', // review
      unsupported: 'እዚ ስልኪ ባርኮድ ክስክን ኣይክእልን። ቁጽሪ ክትጽሕፉ ትኽእሉ።', // review
      denied: 'ናይ ካሜራ ፍቓድ የለን። ቁጽሪ ክትጽሕፉ ትኽእሉ።', // review
      failed: 'ስካን ኣይሰለጠን። ቁጽሪ ክትጽሕፉ ትኽእሉ።', // review
    },
    mic: {
      button: 'ብድምጺ ምእታው', // review
      listening: 'ንሰምዕ ኣለና… ሕጂ ተዛረቡ', // review
      stop: 'ምቕዳሕ ደው ኣብል', // review
      cancel: 'ሰርዝ', // review
      confirmLabel: 'ዝሰማዕናዮ እዚ እዩ። ቅድሚ ምርግጋጽ ከተዐርዩ ትኽእሉ', // review
      typedLabel: 'ጽሑፍ ጽሓፉ', // review
      confirm: 'ኣረጋግጽ', // review
      retry: 'እንደገና ቅዳሕ', // review
      empty: 'ቅድሚ ምርግጋጽ ጽሑፍ የድሊ', // review
      unsupported: 'እዚ ስልኪ ብድምጺ ምእታው ኣይድግፍን። ክትጽሕፉ ትኽእሉ።', // review
      denied: 'ናይ ማይክሮፎን ፍቓድ የለን። ክትጽሕፉ ትኽእሉ።', // review
      offline: 'ርክብ የለን፣ ብድምጺ ምእታው ሕጂ ኣይርከብን። ክትጽሕፉ ትኽእሉ።', // review
      noSpeech: 'ዝኾነ ኣይሰማዕናን። እንደገና ፈትኑ ወይ ጽሓፉ።', // review
      failed: 'ብድምጺ ምእታው ኣይሰለጠን። ክትጽሕፉ ትኽእሉ።', // review
    },
  },
  // W3-03b PWA (share, install, notifications) — machine translation, pending native review.
  pwa: {
    notify: {
      title: 'መፍለጢታት', // review
      subtitle: 'እንታይ ይበጽሓኩምን ናበይን፡ ተሌፎን፡ ኢመይል ወይ WhatsApp።', // review
      unavailable: 'መፍለጢታት ተሌፎን ቀልጢፉ ክጅመር እዩ። ክሳብ ሽዑ መልእኽትታት ብኢመይል ይመጹ።', // review
      deviceTitle: 'እዚ ተሌፎን', // review
      deviceOn: 'መፍለጢታት ኣብዚ ተሌፎን ንጡፋት እዮም', // review
      deviceOff: 'መፍለጢታት ኣብዚ ተሌፎን ጠፊኦም እዮም', // review
      enable: 'ኣብዚ ተሌፎን መፍለጢታት ኣብርሁ', // review
      disable: 'ኣብዚ ተሌፎን መፍለጢታት ኣጥፍኡ', // review
      noKey: 'ኣቕራቢ መፍለጢታት ገና ኣይተራኸበን። እቲ መጠወቒ ምስ ተራኸበ ክሰርሕ እዩ።', // review
      denied: 'እቲ መርበብ መፍለጢታት ነዚ ገጽ ይዓግቶ ኣሎ። ኣብ ቅጥዒ መርበብ ክተፍቅዱ ትኽእሉ።', // review
      unsupported: 'እዚ መርበብ መፍለጢታት ተሌፎን ኣይድግፍን።', // review
      needsInstall: 'ኣብ iPhone መፍለጢታት ካብቲ ዝተጸዓነ ኣፕ ጥራይ እዮም ዝሰርሑ። ካብ ዝርዝር ምክፋል ጽዓንዎ።', // review
      failed: 'ኣይሰለጠን። እንደገና ፈትኑ።', // review
      enabled: 'ኣብዚ ተሌፎን መፍለጢታት በሪሆም', // review
      disabled: 'ኣብዚ ተሌፎን መፍለጢታት ጠፊኦም', // review
      eventsTitle: 'ብዛዕባ እንታይ ነፍልጠኩም', // review
      channelPush: 'ተሌፎን', // review
      channelEmail: 'ኢመይል', // review
      channelWhatsapp: 'WhatsApp', // review
      saved: 'ተዓቂቡ', // review
      test: 'ናይ ፈተነ መፍለጢ ስደዱ', // review
      testSkipped: 'ናይ ፈተነ መፍለጢ ኣይተሰደደን፡ ኣቕራቢ መፍለጢታት ገና ኣይተራኸበን።', // review
      quiet: 'ካብ 23:00 ክሳብ 06:00ን ብሰንበትን መፍለጢ የለን፡ ብመዓልቲ ክሳብ 6።', // review
      events: {
        receiver_morning_brief: 'ናይ ሎሚ ኣቕርቦታት (06:00)', // review
        delivery_late: 'ዝደንጐየ ኣቕርቦት', // review
        approval_waiting: 'ፍቓድ ዝጽበያ ፋክቱራታት', // review
        order_reminder: 'መዘኻኸሪ ትእዛዝ', // review
        claim_overdue: 'መልሲ ዘይብሉ ሕቶ ክሬዲት', // review
        invoice_ocr_failed: 'ዘይተነበበት ፋክቱራ', // review
      },
    },
    install: {
      title: 'RestoMatch ኣብዚ ተሌፎን ክጽዓን?', // review
      body: 'ካብ ቀንዲ ስክሪን ክፈትዎ፡ ብዘይ ሲግናል ስርሑ፡ ብዛዕባ ኣቕርቦታትን ፍቓዳትን መፍለጢ ተቐበሉ።', // review
      install: 'ጽዓን', // review
      later: 'ሕጂ ኣይኮነን', // review
      iosTitle: 'ኣብ iPhone ምጽዓን፡ ሰለስተ ስጉምትታት', // review
      iosStep1: 'ኣብ ታሕቲ ስክሪን ዘሎ መጠወቒ ምክፋል ጠውቑ', // review
      iosStep2: '"ናብ ቀንዲ ስክሪን ወስኽ" ምረጹ', // review
      iosStep3: 'ኣብ ኩርናዕ "ወስኽ" ጠውቑ', // review
      done: 'ተረዲኡኒ', // review
    },
    share: {
      title: 'ናብ RestoMatch ምክፋል', // review
      loading: 'ዘካፈልኩምዎ ንኸፍት ኣለና…', // review
      toOrder: 'ከም ምቕባል ትእዛዝ ንኸፍት ኣለና…', // review
      filesTitle: '{count, plural, one {ሓደ ፋይል ኣብዚ ተሌፎን ተዓቂቡ} other {# ፋይላት ኣብዚ ተሌፎን ተዓቂቦም}}', // review
      filesBody: 'ፋይላት ኣብዚ ተሌፎን ክሳብ 24 ሰዓት ይጸንሑ። ነቲ ኣቕርቦት ከፊትኩም ምስ ፋክቱራ ኣተሓሕዝዎም።', // review
      filesOther: 'ፋይላት ኣብዚ ተሌፎን ክሳብ 24 ሰዓት ይጸንሑ። ንኣመሓዳሪ ወይ ንዋና ኣሕልፍዎም።', // review
      toReceiving: 'ናብ ምቕባል ኣቕሓ', // review
      discard: 'ምክፋል ደምስስ', // review
      discarded: 'ምክፋል ካብዚ ተሌፎን ተደምሲሱ', // review
      skipped: '{count, plural, one {ሓደ ፋይል ኣይተዓቀበን (ስእሊ ወይ PDF ጥራይ፡ ክሳብ 20MB)} other {# ፋይላት ኣይተዓቀቡን (ስእሊ ወይ PDF ጥራይ፡ ክሳብ 20MB)}}', // review
      filesLost: 'ፋይል ኣይበጽሐን። ካብቲ ዝተጸዓነ ኣፕ እንደገና ኣካፍሉ።', // review
      textTitle: 'ዘካፈልኩምዎ ጽሑፍ', // review
      textBody: 'ምቕባል ትእዛዝ ኣብዚ ኣይነጥፍን። ነቲ ጽሑፍ ቀዲሕኩም ኣሕልፍዎ።', // review
      copy: 'ቅዳሕ', // review
      copied: 'ጽሑፍ ተቐዲሑ', // review
      emptyTitle: 'ዝበጽሐ ትሕዝቶ የለን', // review
      emptyBody: 'ምክፋል ግዜኡ ሓሊፉ ወይ ድሮ ተኸፊቱ። እንደገና ኣካፍሉ።', // review
      home: 'ናብ ቀንዲ ገጽ', // review
    },
  },
};
