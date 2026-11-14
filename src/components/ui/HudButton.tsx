import type { ReactNode } from 'react';

interface HudButtonProps {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  testId?: string;
  ariaLabel?: string;
}

/** HUD 按钮：激活态为青蓝色高亮，禁用态变暗且不可点击。 */
export function HudButton({ children, onClick, active, disabled, title, className = '', testId, ariaLabel }: HudButtonProps) {
  const state = disabled
    ? 'cursor-not-allowed border-line/50 text-ink-faint/70'
    : active
      ? 'border-data bg-data/15 text-data shadow-[0_0_12px_rgb(95_212_255/0.25)]'
      : 'border-line text-ink-dim hover:border-data-dim hover:bg-raised hover:text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      data-testid={testId}
      className={`readout pointer-events-auto rounded border px-2.5 py-1 text-[12px] leading-5 transition-colors ${state} ${className}`}
    >
      {children}
    </button>
  );
}
