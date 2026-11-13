import type { Priority } from '@ai-todo/core';
import { t } from '@ai-todo/shared';

export function Checkbox({
  priority,
  done,
  completing,
  onToggle,
  label,
}: {
  priority: Priority;
  done: boolean;
  completing?: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done || completing}
      aria-label={label ?? (done ? t('task.reopen') : t('task.complete'))}
      className="check"
      data-priority={priority}
      data-done={done}
      data-completing={completing}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg
        viewBox="0 0 12 12"
        fill="none"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M2.6 6.3 5 8.6 9.5 3.6" />
      </svg>
    </button>
  );
}
