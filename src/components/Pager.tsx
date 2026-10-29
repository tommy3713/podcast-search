import Link from 'next/link';
import { pageHref, pagerItems } from '@/lib/paging';

export function Pager({ page, total }: { page: number; total: number }) {
  const step = (n: number, label: string, off: boolean) =>
    off ? (
      <span className="step" aria-disabled="true">
        {label}
      </span>
    ) : (
      <Link className="step" href={pageHref(n)}>
        {label}
      </Link>
    );
  return (
    <nav className="pager" aria-label="集數分頁">
      {step(page - 1, '‹ 上一頁', page === 1)}
      {pagerItems(page, total).map((n, i) =>
        n === 'gap' ? (
          <span key={`gap${i}`} className="gap" aria-hidden="true">
            …
          </span>
        ) : (
          <Link key={n} className="num" href={pageHref(n)} aria-current={n === page ? 'page' : undefined} aria-label={`第 ${n} 頁`}>
            {n}
          </Link>
        ),
      )}
      <span className="of">
        {page} / {total}
      </span>
      {step(page + 1, '下一頁 ›', page === total)}
    </nav>
  );
}
