// Machine translation — pending native review (W1-06 follow-up).
import type { Shape } from '../../../../translate';
import type { OverviewReceiverSlice } from '../overview';

/** overview (receiver slice) — ru overlay (Russian). */
export const overview: Shape<OverviewReceiverSlice> = {
  homeTitle: { receiver: 'Поставки на сегодня' },
  homeSubtitle: { receiver: 'Следующая машина сверху, за ней все остальные.' },
  board: {
    summary: 'Сегодня поставок: {total} · принято: {received} · опаздывают: {late}',
    next: 'Следующая машина',
    groups: {
      late: 'Опаздывают',
      now: 'Сейчас / следующая',
      later: 'Позже сегодня',
      undated: 'Без даты',
      received: 'Приняты',
    },
    cta: {
      start: 'Начать приёмку',
      continue: 'Продолжить приёмку',
      received: 'Принято ✓',
      partial: 'Принято частично ✓',
    },
    state: {
      inProgress: 'Идёт приёмка',
      late: 'Опаздывает',
      lateSince: 'Ожидалась {date}',
    },
    items: 'Позиций: {count}',
    noDate: 'Без даты поставки',
    closedAt: 'Закрыто {time}',
    noPo: {
      title: 'Накладная без заказа',
      hint: 'Поставщик приехал без заказа? Попросите менеджера смены открыть заказ — и машина появится здесь для приёмки.',
    },
    empty: {
      title: 'Сегодня поставок не ожидается',
      hint: 'Когда поставщику отправят заказ с датой поставки, машина появится здесь.',
    },
    receipt: {
      title: 'Приёмка · {supplier}',
      readOnly: 'Приёмка закрыта — только просмотр',
      back: 'Назад к доске поставок',
      product: 'Товар',
      ordered: 'Заказано',
      received: 'Получено',
      rejected: 'Отклонено',
      notFound: 'Приёмка не найдена',
      followUp: {
        cta: 'Пришла допоставка — завершить приёмку',
        hint: 'Приёмка откроется снова, чтобы посчитать то, что пришло сейчас. Повторное открытие записывается в журнал.',
        failed: 'Не удалось открыть приёмку. Попробуйте снова.',
      },
    },
  },
};
