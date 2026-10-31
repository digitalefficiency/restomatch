/** Page window for a table footer: "מוצגות 51–100 מתוך 312". Out-of-range pages clamp. */
export interface PageWindow {
  page: number;
  pages: number;
  from: number;
  to: number;
  start: number;
  end: number;
}

export function pageWindow(total: number, page: number, size: number): PageWindow {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const end = Math.min(total, start + size);
  return { page: p, pages, from: total === 0 ? 0 : start + 1, to: end, start, end };
}
