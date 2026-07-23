import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  isPending?: boolean;
  cancelText?: string;
  confirmText?: string;
  loadingText?: string;
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  isPending = false,
  cancelText = "Cancel",
  confirmText = "Confirm",
  loadingText = "Loading...",
}: DeleteConfirmModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-2xl text-center"
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-black text-foreground mb-2">
              {title}
            </h2>
            <p className="text-xs text-muted-foreground/80 leading-relaxed mb-6">
              {description}
            </p>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-2xl py-6 font-bold cursor-pointer"
                onClick={onClose}
                disabled={isPending}
              >
                {cancelText}
              </Button>
              <Button
                type="button"
                className="flex-1 rounded-2xl bg-danger text-white border-0 hover:bg-danger/90 py-6 font-bold cursor-pointer"
                onClick={onConfirm}
                disabled={isPending}
              >
                {isPending ? loadingText : confirmText}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
