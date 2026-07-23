import { type ReactNode, isValidElement, cloneElement } from "react";

export const inputClass =
  "w-full h-[50px] rounded-xl border border-border/40 bg-surface/90 dark:bg-zinc-950/30 pl-10 pr-4 text-sm font-medium text-foreground placeholder:text-muted-foreground/35 transition-all focus:outline-none focus:ring-4 focus:ring-accent/15 focus:border-accent focus:bg-surface/70 dark:focus:bg-zinc-950/70";

export const inputErrorClass =
  "w-full h-[50px] rounded-xl border border-red-500 bg-surface/90 dark:bg-zinc-950/30 pl-10 pr-4 text-sm font-medium text-foreground placeholder:text-muted-foreground/35 transition-all focus:outline-none focus:ring-4 focus:ring-red-500/15 focus:border-red-500 focus:bg-surface/70 dark:focus:bg-zinc-950/70";

interface AuthFieldProps {
  id: string;
  label: string;
  icon: ReactNode;
  children: ReactNode;
  error?: string;
}

export function AuthField({
  id,
  label,
  icon,
  children,
  error,
}: AuthFieldProps) {
  // Inject hasError prop into the child input/password-input component.
  // Custom components (e.g. <PasswordInput>) understand `hasError`; plain DOM
  // elements (e.g. <input>) do not, so for those we only swap className.
  const childIsPlainInput =
    isValidElement(children) && typeof children.type === "string";

  const enhancedChildren =
    isValidElement<{ hasError?: boolean; className?: string }>(children)
      ? cloneElement(children, {
          ...(childIsPlainInput
            ? error
              ? { className: inputErrorClass }
              : {}
            : { hasError: !!error }),
        })
      : children;

  return (
    <div className="flex flex-col gap-1.5 group">
      <label
        htmlFor={id}
        className="text-xs font-bold uppercase text-muted-foreground/60 group-focus-within:text-accent transition-colors duration-200"
      >
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center z-20 text-muted-foreground/50 group-focus-within:text-accent transition-colors duration-200 [&_svg]:text-current">
          {icon}
        </span>
        {enhancedChildren}
      </div>
      {error && (
        <p className="text-[11px] font-semibold text-danger/90 mt-0.5">{error}</p>
      )}
    </div>
  );
}

