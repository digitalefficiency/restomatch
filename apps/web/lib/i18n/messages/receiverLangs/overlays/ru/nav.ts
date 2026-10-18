import type { Shape } from '../../../../translate';
import type { he } from '../../../nav/he';

/** nav — ru overlay (Russian). */
export const nav: Shape<typeof he> = {
  mainLabel: 'Главное меню',
  mobileLabel: 'Быстрое меню',
  skipToContent: 'Перейти к содержимому',
  links: {
    overview: 'Обзор',
    receiving: 'Приёмка',
    approvals: 'Согласования',
    leaks: 'Поиск потерь',
    suppliers: 'Поставщики',
    catalog: 'Каталог',
    orders: 'Заказы',
    exports: 'Экспорт',
    team: 'Команда',
    settings: 'Настройки',
  },
  groups: {
    operations: 'Работа',
    purchasing: 'Закупки',
    admin: 'Управление',
  },
  menu: {
    open: 'Открыть меню',
    close: 'Закрыть меню',
    more: 'Ещё',
    account: 'Аккаунт',
  },
  signOut: 'Выйти',
  search: {
    placeholder: 'Поиск поставщиков, товаров, накладных…',
    shortPlaceholder: 'Поиск…',
    label: 'Поиск по всему приложению',
    searching: 'Ищем…',
    noResults: 'Ничего не найдено',
    minChars: 'Введите не меньше 2 символов',
    error: 'Не удалось выполнить поиск. Попробуйте ещё раз.',
    hint: 'Стрелки — выбрать · Enter — открыть · Esc — закрыть',
    groups: {
      suppliers: 'Поставщики',
      products: 'Товары',
      invoices: 'Накладные',
    },
    noInvoiceNumber: 'Без номера',
  },
  worker: {
    title: 'Система обработки сейчас недоступна.',
    body: 'Загруженные накладные сохранены. Их распознают и сверят, как только система снова заработает.',
    lastBeat: 'Последний сигнал: {minutes} мин назад.',
    ownerNotified: 'Владелец уже получил уведомление.',
  },
  loading: 'Загрузка',
};
