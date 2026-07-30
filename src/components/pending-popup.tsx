"use client";

import { motion } from "framer-motion";
import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { whatsappLink } from "@/lib/utils";

export function PendingPopup({
  whatsappNumber,
  message,
  whatsappMessage,
  name,
  id,
  onClose,
}: {
  whatsappNumber?: string;
  message?: string;
  whatsappMessage?: string;
  name?: string;
  id?: string;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  
  // Decide the default whatsapp message
  const defaultMessage = name && id
    ? t("pending.whatsappMessageWithNameAndId", { name, id })
    : name
    ? t("pending.whatsappMessageWithName", { name })
    : t("pending.whatsappMessage");

  const href = whatsappNumber
    ? whatsappLink(whatsappNumber, whatsappMessage ?? defaultMessage)
    : null;

  const handleClose = onClose ?? (() => {
    window.location.href = "/login";
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={handleClose}
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{
          type: "spring",
          damping: 25,
          stiffness: 350,
          mass: 0.8,
        }}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-2xl z-10"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
          <MessageCircle className="h-6 w-6" />
        </div>
        <h2 className="text-center text-lg font-semibold">
          {t("auth.accountPending")}
        </h2>
        <p className="mt-2 text-center text-sm text-muted">
          {message ?? t("pending.whatsappHint")}
        </p>
        {href && (
          <Button
            className="mt-5 w-full cursor-pointer"
            variant="accent"
            onClick={() => window.open(href, "_blank")}
          >
            <MessageCircle className="h-4 w-4" />
            {t("auth.whatsapp")}
          </Button>
        )}
      </motion.div>
    </div>
  );
}
