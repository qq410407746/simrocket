import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** 标题右侧的英文代号或补充说明。 */
  code?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/** 仪表面板容器。 */
export function Panel({ title, code, children, className = '', testId }: PanelProps) {
  return (
    <section data-testid={testId} className={`panel-frame pointer-events-auto rounded-lg backdrop-blur-md ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-line/70 px-3 py-1.5">
        <h2 className="flex items-center gap-2 text-[12px] font-semibold tracking-wider text-ink">
          <span className="h-3 w-0.5 rounded bg-data" aria-hidden />
          {title}
        </h2>
        {code && <span className="text-[10px] font-medium tracking-[0.2em] text-data-dim uppercase">{code}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** 面板内的小节标题。 */
export function SectionLabel({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mt-3 mb-1.5 flex items-center gap-2 first:mt-0">
      <span className="text-[10px] font-semibold tracking-[0.16em] text-ink-faint uppercase">{children}</span>
      <span className="h-px flex-1 bg-line/60" aria-hidden />
      {note && <span className="text-[10px] text-ink-faint">{note}</span>}
    </div>
  );
}
