// Machine translation — pending native review (W1-06 follow-up).
import type { Shape } from '../../../../translate';
import type { CommonReceiverSlice } from '../common';

/** common (receiver slice: actions, states, shell resilience + screen names) — ar overlay (Arabic). */
export const common: Shape<CommonReceiverSlice> = {
  actions: {
    save: 'حفظ',
    saving: 'جارٍ الحفظ…',
    cancel: 'إلغاء',
    confirm: 'تأكيد',
    close: 'إغلاق',
    back: 'رجوع',
    next: 'التالي',
    previous: 'السابق',
    edit: 'تعديل',
    delete: 'حذف',
    remove: 'إزالة',
    add: 'إضافة',
    create: 'إنشاء',
    search: 'بحث',
    filter: 'تصفية',
    clear: 'مسح',
    retry: 'حاول مرة أخرى',
    refresh: 'تحديث',
    upload: 'رفع',
    download: 'تنزيل',
    export: 'تصدير',
    import: 'استيراد',
    approve: 'موافقة',
    reject: 'رفض',
    loadMore: 'تحميل المزيد',
    viewAll: 'عرض الكل',
    details: 'التفاصيل',
    continue: 'متابعة',
    submit: 'إرسال',
    signOut: 'تسجيل الخروج',
    backToOverview: 'العودة إلى النظرة العامة',
    backHome: 'العودة إلى الصفحة الرئيسية',
  },
  states: {
    loading: 'جارٍ التحميل…',
    empty: 'لا توجد بيانات للعرض',
    error: 'حدث خطأ ما',
    noResults: 'لم يتم العثور على نتائج',
    saved: 'تم الحفظ',
    yes: 'نعم',
    no: 'لا',
    all: 'الكل',
    none: 'بدون',
    unknown: 'غير معروف',
    optional: 'اختياري',
    required: 'إلزامي',
  },
  shell: {
    offline: {
      chip: 'لا يوجد اتصال · سنحدّث عند عودة الشبكة',
      back: 'عاد الاتصال',
      action: 'لا يوجد اتصال — لم يُرسل الإجراء. حاول مرة أخرى عند عودة الشبكة.',
    },
    session: {
      title: 'انتهت صلاحية تسجيل الدخول',
      body: 'سجّل الدخول مرة أخرى — عملك محفوظ. الإجراء الذي لم يُرسل ينتظر نقرة أخرى منك.',
      notSent: 'لم يُرسل الإجراء · انتهت صلاحية تسجيل الدخول. سجّل الدخول وحاول مرة أخرى.',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      submit: 'دخول',
      submitting: 'جارٍ الدخول…',
      wrong: 'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو كانت هناك محاولات كثيرة. حاول مرة أخرى بعد لحظة.',
      rate: 'محاولات كثيرة جدًا. حاول مرة أخرى لاحقًا.',
      magicLink: 'لا توجد كلمة مرور؟ أرسل لي رابط دخول بالبريد',
      magicSent: 'أرسلنا رابط دخول إلى {email}. افتحه ثم عُد إلى هذا التبويب — سنكمل من هنا.',
      magicFailed: 'لم نتمكن من إرسال الرابط. حاول مرة أخرى بعد لحظة.',
      twoFactor: 'هذا الحساب يستخدم التحقق بخطوتين. أكمل الدخول في تبويب جديد ثم عُد إلى هنا.',
      openTwoFactor: 'أكمل التحقق في تبويب جديد',
      checkAgain: 'أكملت — متابعة',
      stillOut: 'لم تسجّل الدخول بعد. أكمل الدخول وحاول مرة أخرى.',
      otherUserLink: 'لست أنت؟ الدخول كمستخدم آخر',
      otherUser: 'دخلت كمستخدم آخر — نعيد تحميل الصفحة.',
      done: 'سجّلت الدخول مرة أخرى. نكمل من حيث توقفت.',
      dismiss: 'إغلاق',
    },
    forbidden: {
      eyebrow: '403 · لا توجد صلاحية',
      title: 'شاشة ‘{screen}’ غير متاحة لدورك',
      allowed: 'الشاشة متاحة لـ: {roles}.',
      youAre: 'دخلت بصفة {role} في {branch}.',
      requestTitle: 'اطلب الصلاحية من المالك',
      requestBody: 'سنجهّز رسالة مع الرابط. يمكن للمالك تغيير الدور في شاشة الفريق.',
      whatsapp: 'اطلب عبر واتساب',
      email: 'اطلب بالبريد الإلكتروني',
      requestText: 'مرحبًا، هل يمكنني الحصول على صلاحية لشاشة ‘{screen}’ في RestoMatch ({branch})؟ الرابط: {url}',
      requestSubject: 'طلب صلاحية لشاشة ‘{screen}’',
      openIn: 'افتح في {branch} ({role})',
      openInHint: 'لديك صلاحية لهذه الشاشة في فرع آخر:',
      refreshTitle: 'تم تحديث دورك',
      refreshBody: 'غيّر المالك صلاحياتك. حدّث الصلاحية لفتح شاشة ‘{screen}’.',
      refreshCta: 'تحديث الصلاحية',
      home: 'العودة إلى الرئيسية',
      notMember: 'هذا الرابط يخص فرعًا ليست لديك صلاحية عليه. اطلب من المالك إضافتك، أو عُد إلى الرئيسية.',
      notMemberTitle: 'ليست لديك صلاحية على هذا الفرع',
    },
    notFound: {
      eyebrow: '404',
      title: 'لم نجد هذه الصفحة',
      body: 'ربما حُذفت، أو أن الرابط خاطئ، أو أنها تخص فرعًا آخر.',
      otherBranch: 'إذا جاء الرابط من فرع آخر، غيّر الفرع من القائمة في أعلى الصفحة.',
      up: 'العودة إلى {screen}',
      home: 'العودة إلى الرئيسية',
    },
    error: {
      title: 'لم نتمكن من تحميل الصفحة',
      body: 'حاول مرة أخرى. إذا تكرر ذلك، احتفظ بالرمز الظاهر هنا — فهو يساعد في تحديد المشكلة.',
      bodyNoCode: 'حاول مرة أخرى بعد لحظة.',
      code: 'الرمز: {digest}',
      retry: 'حاول مرة أخرى',
      retrying: 'جارٍ التحميل مجددًا…',
      home: 'العودة إلى الرئيسية',
      offline: 'لا يوجد اتصال بالشبكة، لذلك لم تُحمَّل الصفحة. سنحمّلها مجددًا عند عودة الاتصال.',
    },
    screens: {
      home: 'الرئيسية',
      receiving: 'استلام البضاعة',
      approvals: 'الموافقات',
      payRun: 'دفعة المدفوعات',
      inbox: 'الفواتير الواردة',
      invoices: 'الفواتير',
      leaks: 'التسرّب',
      claims: 'طلبات إشعار دائن للإرسال',
      leakProof: 'إثبات التسرّب',
      leakReport: 'تقرير التسرّبات',
      recovery: 'متابعة المبالغ المستردة ₪',
      reports: 'التقارير',
      monthlyReport: 'التقرير الشهري',
      ask: 'اسأل RestoMatch',
      suppliers: 'الموردون',
      ledger: 'كشف حساب الموردين',
      catalog: 'الكتالوج',
      orders: 'الطلبيات',
      contracts: 'العقود والأسعار',
      recipes: 'تكلفة الطبق',
      inventory: 'جرد المخزون',
      exports: 'إغلاق الشهر والتصدير',
      integrations: 'الربط',
      team: 'الفريق',
      settings: 'الإعدادات',
      chain: 'نظرة على السلسلة',
      branches: 'الفروع',
    },
    listSep: ', ',
    listLast: ' و',
  },
  // W3-03a field components — machine translation, pending native review.
  field: {
    scan: {
      button: 'مسح الباركود', // review
      scanning: 'وجّه الكاميرا نحو الباركود', // review
      cancel: 'إلغاء', // review
      typeInstead: 'إدخال يدوي', // review
      manualLabel: 'رقم الباركود', // review
      manualHint: 'الأرقام الموجودة تحت الخطوط', // review
      submit: 'تأكيد', // review
      empty: 'يجب كتابة الرقم أولاً', // review
      found: 'تم المسح: {code}', // review
      unsupported: 'هذا الهاتف لا يمسح الباركود. يمكنك كتابة الرقم.', // review
      denied: 'لا يوجد إذن للكاميرا. يمكنك كتابة الرقم.', // review
      failed: 'لم ينجح المسح. يمكنك كتابة الرقم.', // review
    },
    mic: {
      button: 'إدخال صوتي', // review
      listening: 'نستمع… تحدّث الآن', // review
      stop: 'إنهاء التسجيل', // review
      cancel: 'إلغاء', // review
      confirmLabel: 'هذا ما سمعناه. يمكنك التصحيح قبل التأكيد', // review
      typedLabel: 'اكتب النص', // review
      confirm: 'تأكيد', // review
      retry: 'تسجيل من جديد', // review
      empty: 'يجب إدخال نص قبل التأكيد', // review
      unsupported: 'هذا الهاتف لا يدعم الإدخال الصوتي. يمكنك الكتابة.', // review
      denied: 'لا يوجد إذن للميكروفون. يمكنك الكتابة.', // review
      offline: 'لا يوجد اتصال، الإدخال الصوتي غير متاح الآن. يمكنك الكتابة.', // review
      noSpeech: 'لم نسمع شيئاً. حاول مرة أخرى أو اكتب.', // review
      failed: 'لم ينجح الإدخال الصوتي. يمكنك الكتابة.', // review
    },
  },
  // W3-03b PWA (share, install, notifications) — machine translation, pending native review.
  pwa: {
    notify: {
      title: 'الإشعارات', // review
      subtitle: 'ما يصلك وإلى أين: الهاتف أو البريد الإلكتروني أو واتساب.', // review
      unavailable: 'إشعارات الهاتف قادمة قريبًا. حتى ذلك الحين تصل الرسائل بالبريد الإلكتروني.', // review
      deviceTitle: 'هذا الهاتف', // review
      deviceOn: 'الإشعارات مفعّلة على هذا الهاتف', // review
      deviceOff: 'الإشعارات متوقفة على هذا الهاتف', // review
      enable: 'تفعيل الإشعارات على هذا الهاتف', // review
      disable: 'إيقاف الإشعارات على هذا الهاتف', // review
      noKey: 'مزوّد الإشعارات غير متصل بعد. سيعمل الزر عند اكتمال الاتصال.', // review
      denied: 'المتصفح يحظر الإشعارات لهذا الموقع. يمكنك السماح بها من إعدادات المتصفح.', // review
      unsupported: 'هذا المتصفح لا يدعم إشعارات الهاتف.', // review
      needsInstall: 'على الآيفون تعمل الإشعارات فقط من التطبيق المثبّت. ثبّته من قائمة المشاركة.', // review
      failed: 'لم ينجح ذلك. حاول مرة أخرى.', // review
      enabled: 'تم تفعيل الإشعارات على هذا الهاتف', // review
      disabled: 'تم إيقاف الإشعارات على هذا الهاتف', // review
      eventsTitle: 'بماذا نبلغك', // review
      channelPush: 'الهاتف', // review
      channelEmail: 'البريد الإلكتروني', // review
      channelWhatsapp: 'واتساب', // review
      saved: 'تم الحفظ', // review
      test: 'إرسال إشعار تجريبي', // review
      testSkipped: 'لم يُرسل الإشعار التجريبي: مزوّد الإشعارات غير متصل بعد.', // review
      quiet: 'لا إشعارات بين 23:00 و06:00 ولا يوم السبت، وحتى 6 في اليوم.', // review
      events: {
        receiver_morning_brief: 'شحنات اليوم (06:00)', // review
        delivery_late: 'شحنة متأخرة', // review
        approval_waiting: 'فواتير تنتظر الموافقة', // review
        order_reminder: 'تذكير بالطلب', // review
        claim_overdue: 'طلب ائتمان بلا رد', // review
        invoice_ocr_failed: 'فاتورة لم تُقرأ', // review
      },
    },
    install: {
      title: 'تثبيت رستوماتش على هذا الهاتف؟', // review
      body: 'افتحه من الشاشة الرئيسية، اعمل بدون إشارة، واحصل على تنبيهات الشحنات والموافقات.', // review
      install: 'تثبيت', // review
      later: 'ليس الآن', // review
      iosTitle: 'التثبيت على الآيفون: ثلاث خطوات', // review
      iosStep1: 'اضغط زر المشاركة أسفل الشاشة', // review
      iosStep2: 'اختر "إضافة إلى الشاشة الرئيسية"', // review
      iosStep3: 'اضغط "إضافة" في الزاوية', // review
      done: 'فهمت', // review
    },
    share: {
      title: 'مشاركة إلى رستوماتش', // review
      loading: 'نفتح ما شاركته…', // review
      toOrder: 'نفتحه كطلب جديد…', // review
      filesTitle: '{count, plural, one {تم حفظ ملف واحد على هذا الهاتف} other {تم حفظ # ملفات على هذا الهاتف}}', // review
      filesBody: 'تبقى الملفات على هذا الهاتف حتى 24 ساعة. افتح الشحنة وأرفقها بالفاتورة.', // review
      filesOther: 'تبقى الملفات على هذا الهاتف حتى 24 ساعة. مرّرها إلى المدير أو المالك لإرفاقها.', // review
      toReceiving: 'إلى استلام البضائع', // review
      discard: 'حذف المشاركة', // review
      discarded: 'تم حذف المشاركة من هذا الهاتف', // review
      skipped: '{count, plural, one {لم يُحفظ ملف واحد (صورة أو PDF فقط، حتى 20MB)} other {لم تُحفظ # ملفات (صورة أو PDF فقط، حتى 20MB)}}', // review
      filesLost: 'لم يصل الملف. شارك مرة أخرى من التطبيق المثبّت.', // review
      textTitle: 'النص الذي شاركته', // review
      textBody: 'إدخال الطلبات غير مفعّل هنا. يمكنك نسخ النص وتمريره.', // review
      copy: 'نسخ', // review
      copied: 'تم نسخ النص', // review
      emptyTitle: 'لم يصل أي محتوى', // review
      emptyBody: 'انتهت صلاحية المشاركة أو فُتحت مسبقًا. شارك مرة أخرى.', // review
      home: 'إلى الشاشة الرئيسية', // review
    },
  },
};
