import { type ReactNode, isValidElement, cloneElement } from "react";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FormFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "children"> {
  label: string;
  name: string;
  description?: string | React.ReactNode;
  children?: ReactNode;
  error?: string;
}

export function FormField({
  label,
  name,
  description,
  children,
  error,
  className,
  ...props
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <Label htmlFor={name} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      {description && (
        <p className="text-[10px] text-muted-foreground leading-snug">
          {description}
        </p>
      )}
      {children ? (
        isValidElement<{ hasError?: boolean }>(children)
          ? cloneElement(children, { hasError: !!error })
          : children
      ) : (
        <Input
          id={name}
          name={name}
          hasError={!!error}
          className={cn(
            "h-11 rounded-xl border-border/50 bg-surface/90 px-3 text-sm focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:border-accent/50 transition-all placeholder:text-muted-foreground/30",
            className
          )}
          {...props}
        />
      )}
      {error && (
        <p className="text-[11px] font-semibold text-danger/90">{error}</p>
      )}
    </div>
  );
}

