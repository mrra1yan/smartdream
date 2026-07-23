"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { ChevronDown, HelpCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/page-header";

interface FaqItem {
  q: string;
  a: string;
}

export function FaqAccordion({ faqList }: { faqList: FaqItem[] }) {
  const { t } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(0); // First one open by default

  const toggleIndex = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="flex flex-col gap-6 py-2">
      {/* Header */}
      <PageHeader
        badge={t("faq.badge")}
        title={t("faq.title")}
        description={t("faq.subtitle")}
      />

      {/* Accordion List */}
      <div className="flex flex-col gap-3">
        {faqList.map((item, idx) => {
          const isOpen = openIndex === idx;

          return (
            <div
              key={idx}
              className={`rounded-2xl border transition-all duration-300  overflow-hidden ${
                isOpen
                  ? "border-accent/30 bg-surface/50 shadow-md shadow-accent/5"
                  : "border-border/40 bg-surface/90 hover:border-accent/20 hover:bg-surface/90"
              }`}
            >
              {/* Question Header */}
              <button
                onClick={() => toggleIndex(idx)}
                className="w-full flex items-center justify-between gap-4 p-5 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <HelpCircle className={`h-5 w-5 shrink-0 transition-colors ${isOpen ? "text-accent" : "text-muted-foreground"}`} />
                  <span className="text-sm sm:text-base font-bold text-foreground leading-snug">
                    {item.q}
                  </span>
                </div>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${
                    isOpen ? "rotate-180 text-accent" : ""
                  }`}
                />
              </button>

              {/* Answer Content */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="px-5 pb-5 pt-0 pl-11">
                      <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground/95">
                        {item.a}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
