// Machine translation — pending native review (W1-06 follow-up).
import type { Shape } from '../../../../translate';
import type { CommonReceiverSlice } from '../common';

/** common (receiver slice: actions, states, shell resilience + screen names) — ru overlay (Russian). */
export const common: Shape<CommonReceiverSlice> = {
  actions: {
    save: 'Сохранить',
    saving: 'Сохраняем…',
    cancel: 'Отмена',
    confirm: 'Подтвердить',
    close: 'Закрыть',
    back: 'Назад',
    next: 'Далее',
    previous: 'Назад',
    edit: 'Изменить',
    delete: 'Удалить',
    remove: 'Убрать',
    add: 'Добавить',
    create: 'Создать',
    search: 'Поиск',
    filter: 'Фильтр',
    clear: 'Очистить',
    retry: 'Попробовать снова',
    refresh: 'Обновить',
    upload: 'Загрузить',
    download: 'Скачать',
    export: 'Экспорт',
    import: 'Импорт',
    approve: 'Одобрить',
    reject: 'Отклонить',
    loadMore: 'Загрузить ещё',
    viewAll: 'Показать всё',
    details: 'Подробнее',
    continue: 'Продолжить',
    submit: 'Отправить',
    signOut: 'Выйти',
    backToOverview: 'Назад к обзору',
    backHome: 'На главную',
  },
  states: {
    loading: 'Загрузка…',
    empty: 'Нет данных для показа',
    error: 'Что-то пошло не так',
    noResults: 'Ничего не найдено',
    saved: 'Сохранено',
    yes: 'Да',
    no: 'Нет',
    all: 'Все',
    none: 'Нет',
    unknown: 'Неизвестно',
    optional: 'Необязательно',
    required: 'Обязательно',
  },
  shell: {
    offline: {
      chip: 'Нет связи · обновим, когда сеть вернётся',
      back: 'Связь восстановлена',
      action: 'Нет связи — действие не отправлено. Попробуйте снова, когда сеть вернётся.',
    },
    session: {
      title: 'Срок входа истёк',
      body: 'Войдите снова — ваша работа сохранена. Неотправленное действие ждёт повторного нажатия.',
      notSent: 'Действие не отправлено · срок входа истёк. Войдите и попробуйте снова.',
      email: 'Эл. почта',
      password: 'Пароль',
      submit: 'Войти',
      submitting: 'Входим…',
      wrong: 'Неверная почта или пароль, либо слишком много попыток. Попробуйте снова через минуту.',
      rate: 'Слишком много попыток. Попробуйте позже.',
      magicLink: 'Нет пароля? Пришлите мне ссылку для входа на почту',
      magicSent: 'Мы отправили ссылку для входа на {email}. Откройте её и вернитесь на эту вкладку — продолжим отсюда.',
      magicFailed: 'Не удалось отправить ссылку. Попробуйте снова через минуту.',
      twoFactor: 'В этом аккаунте включена двухэтапная проверка. Завершите вход в новой вкладке и вернитесь сюда.',
      openTwoFactor: 'Завершить проверку в новой вкладке',
      checkAgain: 'Готово — продолжить',
      stillOut: 'Вы ещё не вошли. Завершите вход и попробуйте снова.',
      otherUserLink: 'Не вы? Войти как другой пользователь',
      otherUser: 'Вы вошли как другой пользователь — перезагружаем страницу.',
      done: 'Вы снова вошли. Продолжаем с того места, где остановились.',
      dismiss: 'Закрыть',
    },
    forbidden: {
      eyebrow: '403 · Нет доступа',
      title: 'Экран ‘{screen}’ недоступен для вашей роли',
      allowed: 'Экран доступен для: {roles}.',
      youAre: 'Вы вошли как {role} в {branch}.',
      requestTitle: 'Попросите доступ у владельца',
      requestBody: 'Мы подготовим сообщение со ссылкой. Владелец может изменить роль на экране «Команда».',
      whatsapp: 'Запрос в WhatsApp',
      email: 'Запрос по почте',
      requestText: 'Здравствуйте, можно получить доступ к экрану ‘{screen}’ в RestoMatch ({branch})? Ссылка: {url}',
      requestSubject: 'Запрос доступа к экрану ‘{screen}’',
      openIn: 'Открыть в {branch} ({role})',
      openInHint: 'У вас есть доступ к этому экрану в другом филиале:',
      refreshTitle: 'Ваша роль обновлена',
      refreshBody: 'Владелец изменил ваши права. Обновите доступ, чтобы открыть экран ‘{screen}’.',
      refreshCta: 'Обновить доступ',
      home: 'На главную',
      notMember: 'Ссылка относится к филиалу, к которому у вас нет доступа. Попросите владельца добавить вас или вернитесь на главную.',
      notMemberTitle: 'У вас нет доступа к этому филиалу',
    },
    notFound: {
      eyebrow: '404',
      title: 'Мы не нашли эту страницу',
      body: 'Возможно, её удалили, ссылка неверна или она относится к другому филиалу.',
      otherBranch: 'Если ссылка пришла из другого филиала, смените филиал в переключателе вверху страницы.',
      up: 'Назад: {screen}',
      home: 'На главную',
    },
    error: {
      title: 'Не удалось загрузить страницу',
      body: 'Попробуйте снова. Если это повторяется, сохраните показанный здесь код — он помогает найти проблему.',
      bodyNoCode: 'Попробуйте снова через минуту.',
      code: 'Код: {digest}',
      retry: 'Попробовать снова',
      retrying: 'Загружаем снова…',
      home: 'На главную',
      offline: 'Нет подключения к сети, поэтому страница не загрузилась. Загрузим её снова, когда связь вернётся.',
    },
    screens: {
      home: 'Главная',
      receiving: 'Приёмка товара',
      approvals: 'Согласования',
      payRun: 'Пакет платежей',
      inbox: 'Входящие накладные',
      invoices: 'Накладные',
      leaks: 'Утечка',
      claims: 'Запросы на кредит-ноту к отправке',
      leakProof: 'Доказательство утечки',
      leakReport: 'Отчёт об утечках',
      recovery: 'Возврат ₪',
      reports: 'Отчёты',
      monthlyReport: 'Месячный отчёт',
      ask: 'Спросить RestoMatch',
      suppliers: 'Поставщики',
      ledger: 'Карточка поставщиков',
      catalog: 'Каталог',
      orders: 'Заказы',
      contracts: 'Договоры и цены',
      recipes: 'Себестоимость блюда',
      inventory: 'Инвентаризация',
      exports: 'Закрытие месяца и экспорт',
      integrations: 'Подключения',
      team: 'Команда',
      settings: 'Настройки',
      chain: 'Обзор сети',
      branches: 'Филиалы',
    },
    listSep: ', ',
    listLast: ' и ',
  },
  // W3-03a field components — machine translation, pending native review.
  field: {
    scan: {
      button: 'Сканировать штрихкод', // review
      scanning: 'Наведите камеру на штрихкод', // review
      cancel: 'Отмена', // review
      typeInstead: 'Ввести вручную', // review
      manualLabel: 'Номер штрихкода', // review
      manualHint: 'Цифры под полосками', // review
      submit: 'Подтвердить', // review
      empty: 'Сначала введите номер', // review
      found: 'Отсканировано: {code}', // review
      unsupported: 'Этот телефон не сканирует штрихкоды. Введите номер вручную.', // review
      denied: 'Нет доступа к камере. Введите номер вручную.', // review
      failed: 'Сканирование не удалось. Введите номер вручную.', // review
    },
    mic: {
      button: 'Голосовой ввод', // review
      listening: 'Слушаем… говорите', // review
      stop: 'Остановить запись', // review
      cancel: 'Отмена', // review
      confirmLabel: 'Вот что мы услышали. Исправьте перед подтверждением', // review
      typedLabel: 'Введите текст', // review
      confirm: 'Подтвердить', // review
      retry: 'Записать снова', // review
      empty: 'Сначала добавьте текст', // review
      unsupported: 'Этот телефон не поддерживает голосовой ввод. Введите текст.', // review
      denied: 'Нет доступа к микрофону. Введите текст.', // review
      offline: 'Нет связи, голосовой ввод сейчас недоступен. Введите текст.', // review
      noSpeech: 'Мы ничего не услышали. Попробуйте снова или введите текст.', // review
      failed: 'Голосовой ввод не сработал. Введите текст.', // review
    },
  },
  // W3-03b PWA (share, install, notifications) — machine translation, pending native review.
  pwa: {
    notify: {
      title: 'Уведомления', // review
      subtitle: 'Что вам приходит и куда: телефон, e-mail или WhatsApp.', // review
      unavailable: 'Уведомления на телефон скоро появятся. Пока сообщения приходят по e-mail.', // review
      deviceTitle: 'Этот телефон', // review
      deviceOn: 'Уведомления на этом телефоне включены', // review
      deviceOff: 'Уведомления на этом телефоне выключены', // review
      enable: 'Включить уведомления на этом телефоне', // review
      disable: 'Выключить уведомления на этом телефоне', // review
      noKey: 'Сервис уведомлений ещё не подключён. Кнопка заработает после подключения.', // review
      denied: 'Браузер блокирует уведомления для этого сайта. Разрешите их в настройках браузера.', // review
      unsupported: 'Этот браузер не поддерживает уведомления на телефон.', // review
      needsInstall: 'На iPhone уведомления работают только в установленном приложении. Установите его через меню «Поделиться».', // review
      failed: 'Не получилось. Попробуйте ещё раз.', // review
      enabled: 'Уведомления на этом телефоне включены', // review
      disabled: 'Уведомления на этом телефоне выключены', // review
      eventsTitle: 'О чём уведомлять', // review
      channelPush: 'Телефон', // review
      channelEmail: 'E-mail', // review
      channelWhatsapp: 'WhatsApp', // review
      saved: 'Сохранено', // review
      test: 'Отправить тестовое уведомление', // review
      testSkipped: 'Тестовое уведомление не отправлено: сервис уведомлений ещё не подключён.', // review
      quiet: 'Нет уведомлений с 23:00 до 06:00 и в шабат, не более 6 в день.', // review
      events: {
        receiver_morning_brief: 'Поставки сегодня (06:00)', // review
        delivery_late: 'Поставка опаздывает', // review
        approval_waiting: 'Счета ждут утверждения', // review
        order_reminder: 'Напоминание о заказе', // review
        claim_overdue: 'Требование о кредите без ответа', // review
        invoice_ocr_failed: 'Счёт не удалось прочитать', // review
      },
    },
    install: {
      title: 'Установить RestoMatch на этот телефон?', // review
      body: 'Открывайте с главного экрана, работайте без сети и получайте оповещения о поставках и утверждениях.', // review
      install: 'Установить', // review
      later: 'Не сейчас', // review
      iosTitle: 'Установка на iPhone: три шага', // review
      iosStep1: 'Нажмите кнопку «Поделиться» внизу экрана', // review
      iosStep2: 'Выберите «На экран „Домой“»', // review
      iosStep3: 'Нажмите «Добавить» в углу', // review
      done: 'Понятно', // review
    },
    share: {
      title: 'Поделиться в RestoMatch', // review
      loading: 'Открываем то, чем вы поделились…', // review
      toOrder: 'Открываем как приём заказа…', // review
      filesTitle: '{count, plural, one {# файл сохранён на этом телефоне} few {# файла сохранены на этом телефоне} many {# файлов сохранены на этом телефоне} other {# файла сохранены на этом телефоне}}', // review
      filesBody: 'Файлы хранятся на этом телефоне до 24 часов. Откройте поставку и прикрепите их к счёту.', // review
      filesOther: 'Файлы хранятся на этом телефоне до 24 часов. Передайте их менеджеру или владельцу.', // review
      toReceiving: 'К приёмке товара', // review
      discard: 'Удалить', // review
      discarded: 'Удалено с этого телефона', // review
      skipped: '{count, plural, one {# файл не сохранён (только фото или PDF, до 20MB)} few {# файла не сохранены (только фото или PDF, до 20MB)} many {# файлов не сохранены (только фото или PDF, до 20MB)} other {# файла не сохранены (только фото или PDF, до 20MB)}}', // review
      filesLost: 'Файл не дошёл. Поделитесь ещё раз из установленного приложения.', // review
      textTitle: 'Текст, которым вы поделились', // review
      textBody: 'Приём заказов здесь не включён. Скопируйте текст и передайте его.', // review
      copy: 'Копировать', // review
      copied: 'Текст скопирован', // review
      emptyTitle: 'Ничего не пришло', // review
      emptyBody: 'Срок истёк или уже открыто. Поделитесь ещё раз.', // review
      home: 'На главную', // review
    },
  },
};
