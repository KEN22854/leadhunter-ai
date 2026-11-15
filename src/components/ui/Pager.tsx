"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";

/** Нумерованная пагинация: 1 … p-2 p-1 [p] p+1 p+2 … N */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <nav className="flex flex-wrap items-center justify-center gap-1" aria-label="Страницы">
      <Button size="sm" variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Предыдущая" />
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-muted">…</span>}
          <button type="button" className="chip min-w-9 justify-center" data-active={n === page} onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined}>
            {n}
          </button>
        </span>
      ))}
      <Button size="sm" variant="ghost" icon={<ChevronRight className="h-4 w-4" />} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Следующая" />
    </nav>
  );
}
