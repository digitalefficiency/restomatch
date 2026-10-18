import type { Shape } from '../../../../translate';
import type { he } from '../../../components/he';

/** components — ru overlay (Russian). */
export const components: Shape<typeof he> = {
  spinner: { loading: 'Загрузка' },
  loadMore: { label: 'Показать ещё' },
  breadcrumbs: { label: 'Навигационная цепочка' },
  toast: {
    region: 'Уведомления',
    dismiss: 'Закрыть уведомление',
  },
  errors: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
    network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    forbidden: 'У вас нет прав на это действие.',
    notFound: 'Не найдено — возможно, запись удалена.',
    validation: 'Некоторые поля заполнены неверно. Проверьте и попробуйте ещё раз.',
    tooMany: 'Слишком много попыток. Подождите немного и попробуйте снова.',
  },
  entitlement: {
    features: {
      advanced_analytics: 'Расширенная аналитика',
      accounting_export: 'Экспорт в бухгалтерию',
      whatsapp_alerts: 'Уведомления в WhatsApp',
      integrations: 'Интеграции',
    },
    compactTitle: 'Перейдите на платный тариф, чтобы открыть: {feature}',
    compactBody: 'Эта функция доступна на платных тарифах.',
    compactCta: 'К тарифам',
    title: 'Перейдите на платный тариф, чтобы открыть: {feature}',
    body: 'Функция «{feature}» доступна на платных тарифах. Смените тариф, чтобы получить полный доступ.',
    cta: 'Выбрать тариф',
  },
  errorNotice: { title: 'Что-то пошло не так' },
  activity: {
    types: {
      invoice_received: 'Получена накладная',
      invoice_matched: 'Накладная сверена',
      discrepancy_approved: 'Расхождение подтверждено',
      discrepancy_rejected: 'Расхождение отклонено',
      alias_learned: 'Система запомнила название товара',
      sync_completed: 'Синхронизация завершена',
      other: 'Обновление',
    },
    invoiceReceivedNumbered: 'Получена накладная {number}',
    consolidatedReceivedNumbered: 'Получена сводная накладная {number}',
    inclVat: '{amount} с НДС',
    matchesOrder: 'совпадает с заказом и приёмкой товара',
    awaitingDeliveryNotes: 'ожидает сверки с документами поставок за эту неделю',
    invoiceMatchedNumbered: 'Накладная {number} сверена',
    discrepancyOne: '1 расхождение',
    discrepancies: 'Расхождений: {count}',
    potentialLoss: 'возможная потеря {amount}',
    savings: 'сэкономлено {amount}',
    matchesOrderAndReceipt: 'совпадает с заказом и приёмкой товара',
    awaitingMonthlyMatch: 'ожидает сверки с документами поставок за этот месяц',
    empty: 'Пока нет событий.',
  },
};
