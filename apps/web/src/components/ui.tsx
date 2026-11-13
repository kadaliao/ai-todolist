import { ContextMenu as CM, DropdownMenu as DM, Dialog as RD, Popover as RP, Tooltip as RT } from 'radix-ui';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { forwardRef } from 'react';

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger';
  size?: 'sm' | 'md';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'subtle', size = 'md', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] font-medium transition-[background,color,box-shadow] duration-100 disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' &&
          'bg-jade text-jade-ink shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)] hover:brightness-[1.06] active:brightness-95',
        variant === 'subtle' && 'bg-hover text-ink hover:bg-active',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        variant === 'danger' && 'bg-danger text-white hover:brightness-105',
        className,
      )}
      {...props}
    />
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function IconButton({ label, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-7 shrink-0 select-none items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink data-[state=open]:bg-active data-[state=open]:text-ink',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 font-sans text-[11px] font-medium text-ink-2 shadow-[0_1px_0_var(--line-strong)]">
      {children}
    </kbd>
  );
}

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

// ---------------------------------------------------------------------------------------------
// Popover

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverAnchor = RP.Anchor;

export function PopoverContent({ className, children, ...props }: ComponentProps<typeof RP.Content>) {
  return (
    <RP.Portal>
      <RP.Content
        sideOffset={6}
        collisionPadding={12}
        className={cx(
          'z-50 rounded-[11px] border border-line bg-raised text-ink shadow-pop outline-none',
          'data-[state=open]:animate-[pop-in_120ms_cubic-bezier(.2,.9,.3,1.2)] origin-[var(--radix-popover-content-transform-origin)]',
          className,
        )}
        {...props}
      >
        {children}
      </RP.Content>
    </RP.Portal>
  );
}

// ---------------------------------------------------------------------------------------------
// Menus (dropdown + context share item styling)

const itemClass =
  'relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-[6px] px-2 text-[13px] text-ink outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-40 [&>svg]:size-[15px] [&>svg]:text-ink-2';
const menuClass =
  'z-50 min-w-[200px] rounded-[10px] border border-line bg-raised p-1 shadow-pop data-[state=open]:animate-[pop-in_110ms_cubic-bezier(.2,.9,.3,1.2)] origin-[var(--radix-dropdown-menu-content-transform-origin)]';

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export const MenuSub = DM.Sub;

export function MenuContent({ className, ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={4} collisionPadding={12} className={cx(menuClass, className)} {...props} />
    </DM.Portal>
  );
}

export function MenuItem({
  className,
  shortcut,
  children,
  danger,
  ...props
}: ComponentProps<typeof DM.Item> & { shortcut?: string; danger?: boolean }) {
  return (
    <DM.Item className={cx(itemClass, danger && 'text-danger [&>svg]:text-danger', className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-[11.5px] text-ink-3">{shortcut}</span>}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="mx-1.5 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-ink-3">{children}</DM.Label>;
}

export function MenuSubTrigger({ className, children, ...props }: ComponentProps<typeof DM.SubTrigger>) {
  return (
    <DM.SubTrigger className={cx(itemClass, 'data-[state=open]:bg-hover', className)} {...props}>
      {children}
      <span className="ml-auto text-ink-3">›</span>
    </DM.SubTrigger>
  );
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent sideOffset={6} collisionPadding={12} className={cx(menuClass, className)} {...props} />
    </DM.Portal>
  );
}

export const Context = CM.Root;
export const ContextTrigger = CM.Trigger;

export function ContextContent({ className, ...props }: ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content collisionPadding={12} className={cx(menuClass, className)} {...props} />
    </CM.Portal>
  );
}

export function ContextItem({
  className,
  shortcut,
  children,
  danger,
  ...props
}: ComponentProps<typeof CM.Item> & { shortcut?: string; danger?: boolean }) {
  return (
    <CM.Item className={cx(itemClass, danger && 'text-danger [&>svg]:text-danger', className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-[11.5px] text-ink-3">{shortcut}</span>}
    </CM.Item>
  );
}

export function ContextSeparator() {
  return <CM.Separator className="mx-1.5 my-1 h-px bg-line" />;
}

export const ContextSub = CM.Sub;

export function ContextSubTrigger({ className, children, ...props }: ComponentProps<typeof CM.SubTrigger>) {
  return (
    <CM.SubTrigger className={cx(itemClass, 'data-[state=open]:bg-hover', className)} {...props}>
      {children}
      <span className="ml-auto text-ink-3">›</span>
    </CM.SubTrigger>
  );
}

export function ContextSubContent({ className, ...props }: ComponentProps<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent sideOffset={6} collisionPadding={12} className={cx(menuClass, className)} {...props} />
    </CM.Portal>
  );
}

// ---------------------------------------------------------------------------------------------
// Dialog

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  hideTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  hideTitle?: boolean;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-[rgba(16,19,26,0.32)] backdrop-blur-[2px] data-[state=open]:animate-[fade-in_140ms_ease-out]" />
        <RD.Content
          className={cx(
            'fixed left-1/2 top-[14vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-[14px] border border-line bg-raised text-ink shadow-float outline-none',
            'data-[state=open]:animate-[dialog-in_170ms_cubic-bezier(.2,.9,.3,1.1)]',
            className,
          )}
        >
          <RD.Title className={hideTitle ? 'sr-only' : 'px-5 pt-4 text-[15px] font-semibold'}>
            {title}
          </RD.Title>
          {description ? (
            <RD.Description className="px-5 pt-1 text-[13px] text-ink-2">{description}</RD.Description>
          ) : (
            <RD.Description className="sr-only">{title}</RD.Description>
          )}
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function Tooltip({
  label,
  children,
  side = 'bottom',
}: {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <RT.Root delayDuration={500}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex items-center gap-1.5 rounded-[6px] bg-ink px-2 py-1 text-[12px] text-bg shadow-pop data-[state=delayed-open]:animate-[fade-in_100ms_ease-out]"
        >
          {label}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

export const TooltipProvider = RT.Provider;
