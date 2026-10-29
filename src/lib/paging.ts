// Page 1 shows the newest episode as a hero card above the list, so the list itself
// starts at the second episode and every page holds PER_PAGE rows.
export const PER_PAGE = 20;

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil((total - 1) / PER_PAGE));
}

export function clampPage(raw: string | string[] | undefined, total: number): number {
  const n = Number.parseInt(String(Array.isArray(raw) ? raw[0] : (raw ?? '1')), 10);
  return Math.min(Math.max(1, Number.isFinite(n) ? n : 1), pageCount(total));
}

// Offset into the newest-first episode list for a page's rows
export function pageOffset(page: number): number {
  return 1 + (page - 1) * PER_PAGE;
}

// The list page an episode appears on, given its newest-first index
export function pageOfIndex(index: number): number {
  return index === 0 ? 1 : Math.floor((index - 1) / PER_PAGE) + 1;
}

export function pageHref(page: number): string {
  return page === 1 ? '/' : `/?page=${page}`;
}

// 1 … cur-1 cur cur+1 … total
export function pagerItems(cur: number, total: number): (number | 'gap')[] {
  const nums = [...new Set([1, total, cur - 1, cur, cur + 1])].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) out.push('gap');
    out.push(n);
    prev = n;
  }
  return out;
}
