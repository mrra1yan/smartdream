"use client";

import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Trash2, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ConfirmVariant = "danger" | "warning" | "default";

interface ConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
}

const variantConfig = {
  danger: {
    icon: Trash2,
    iconBg: "bg-danger/15",
    iconColor: "text-danger",
    ringColor: "ring-danger/20",
    glowColor: "bg-danger/8",
    confirmVariant: "danger" as const,
  },
  warning: {
    icon: AlertTriangle,
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-500",
    ringColor: "ring-amber-500/20",
    glowColor: "bg-amber-500/8",
    confirmVariant: "accent" as const,
  },
  default: {
    icon: ShieldAlert,
    iconBg: "bg-accent/15",
    iconColor: "text-accent",
    ringColor: "ring-accent/20",
    glowColor: "bg-accent/8",
    confirmVariant: "accent" as const,
  },
};

export function ConfirmModal({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
}: ConfirmModalProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  // ESC to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        onCancel();
      }
    },
    [open, onCancel],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/60"
            aria-hidden="true"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 16 }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 350,
              mass: 0.8,
            }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            aria-describedby={description ? "confirm-modal-desc" : undefined}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border/40 bg-surface/95 shadow-2xl"
          >
            {/* Decorative glow */}
            <div
              className={`absolute -right-12 -top-12 h-32 w-32 rounded-full ${config.glowColor} blur-3xl pointer-events-none`}
            />
            <div
              className={`absolute -left-12 -bottom-12 h-32 w-32 rounded-full ${config.glowColor} blur-3xl pointer-events-none opacity-50`}
            />

            {/* Close button */}
            <button
              type="button"
              onClick={onCancel}
              className="absolute top-3.5 right-3.5 rounded-full p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors cursor-pointer z-10"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Content */}
            <div className="relative flex flex-col items-center px-6 pt-8 pb-6 gap-4">
              {/* Icon */}
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{
                  type: "spring",
                  damping: 12,
                  stiffness: 200,
                  delay: 0.1,
                }}
                className={`flex h-16 w-16 items-center justify-center rounded-2xl ${config.iconBg} ring-1 ${config.ringColor} shadow-lg`}
              >
                <Icon className={`h-7 w-7 ${config.iconColor}`} />
              </motion.div>

              {/* Title */}
              <h2
                id="confirm-modal-title"
                className="text-lg font-black text-foreground text-center"
              >
                {title}
              </h2>

              {/* Description */}
              {description && (
                <p
                  id="confirm-modal-desc"
                  className="text-sm text-muted-foreground text-center leading-relaxed max-w-[280px]"
                >
                  {description}
                </p>
              )}

              {/* Actions */}
              <div className="flex w-full gap-3 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={loading}
                  className="flex-1 h-11 rounded-xl font-bold text-xs uppercase"
                >
                  {cancelLabel}
                </Button>
                <Button
                  type="button"
                  variant={config.confirmVariant}
                  onClick={onConfirm}
                  disabled={loading}
                  className="flex-1 h-11 rounded-xl font-bold text-xs uppercase"
                >
                  {loading ? (
                    <motion.span
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ repeat: Infinity, duration: 1.2 }}
                    >
                      •••
                    </motion.span>
                  ) : (
                    confirmLabel
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
