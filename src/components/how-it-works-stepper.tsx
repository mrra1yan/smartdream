"use client";

import { useI18n } from "@/components/i18n-provider";
import { useState } from "react";
import { UserPlus, CheckCircle, Link2, RefreshCw, BarChart3, Sparkles, Gift, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

const steps = [
  { id: 1, icon: UserPlus, titleKey: "howItWorks.step1Title", descKey: "howItWorks.step1Desc" },
  { id: 2, icon: CheckCircle, titleKey: "howItWorks.step2Title", descKey: "howItWorks.step2Desc" },
  { id: 3, icon: Link2, titleKey: "howItWorks.step3Title", descKey: "howItWorks.step3Desc" },
  { id: 4, icon: RefreshCw, titleKey: "howItWorks.step4Title", descKey: "howItWorks.step4Desc" },
  { id: 5, icon: BarChart3, titleKey: "howItWorks.step5Title", descKey: "howItWorks.step5Desc" },
  { id: 6, icon: Sparkles, titleKey: "howItWorks.step6Title", descKey: "howItWorks.step6Desc" },
  { id: 7, icon: Gift, titleKey: "howItWorks.step7Title", descKey: "howItWorks.step7Desc" },
];

const toBengaliNumber = (num: number | string, locale: string): string => {
  const str = String(num);
  if (locale !== "bn") return str;
  const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  return str.replace(/[0-9]/g, (digit) => bnDigits[parseInt(digit)]);
};

export function HowItWorksStepper() {
  const { t, locale } = useI18n();
  const [activeStep, setActiveStep] = useState(0);

  const nextStep = () => {
    if (activeStep < steps.length - 1) setActiveStep((prev) => prev + 1);
  };

  const prevStep = () => {
    if (activeStep > 0) setActiveStep((prev) => prev - 1);
  };

  const CurrentIcon = steps[activeStep].icon;

  return (
    <div className="flex flex-col gap-6 py-2">
      {/* Header */}
      <PageHeader
        badge={t("howItWorks.howItWorks")}
        title={t("howItWorks.title")}
        description={t("howItWorks.subtitle")}
      />

      {/* Stepper Navigation */}
      {/* Desktop Stepper */}
      <div className="hidden sm:flex items-center justify-between relative px-2 my-4">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-border/40 z-0" />
        <div 
          className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 bg-gradient-to-r from-accent to-purple-600 z-0 transition-all duration-300"
          style={{ width: `${(activeStep / (steps.length - 1)) * 100}%` }}
        />

        {steps.map((step, idx) => {
          const isActive = idx === activeStep;
          const isCompleted = idx < activeStep;

          return (
            <button
              key={step.id}
              onClick={() => setActiveStep(idx)}
              className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-extrabold transition-all duration-300 ${
                isActive
                  ? "bg-accent border-accent text-white shadow-lg shadow-accent/20 scale-110"
                  : isCompleted
                    ? "bg-purple-600 border-purple-600 text-white"
                    : "border-border bg-background text-muted-foreground hover:border-accent/40"
              }`}
            >
              {toBengaliNumber(step.id, locale)}
            </button>
          );
        })}
      </div>

      {/* Mobile Stepper Indicator */}
      <div className="flex sm:hidden items-center justify-between px-2 text-xs font-semibold text-muted-foreground gap-4 my-2">
        <span>{t("howItWorks.stepOf", { current: toBengaliNumber(activeStep + 1, locale), total: toBengaliNumber(steps.length, locale) })}</span>
        <div className="flex-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-accent to-purple-600 transition-all duration-300"
            style={{ width: `${((activeStep + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 sm:p-8 shadow-xl min-h-[340px] flex flex-col justify-between">
        <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
        
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-5 relative min-h-[180px] justify-center"
          >
            {/* Large background icon to fill empty space */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-accent/[0.06] dark:text-accent/[0.03] hidden md:block select-none">
              <CurrentIcon className="h-48 w-48 stroke-[0.75]" />
            </div>

            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-purple-600 text-white shadow-lg shadow-accent/20 z-10">
              <CurrentIcon className="h-6 w-6" />
            </div>

            <div className="space-y-3 z-10 md:max-w-[70%]">
              <span className="inline-flex items-center rounded-md bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/20 w-fit">
                {t("howItWorks.step")} {toBengaliNumber(activeStep + 1, locale)}
              </span>
              <h2 className="text-xl sm:text-2xl font-extrabold text-foreground">
                {t(steps[activeStep].titleKey)}
              </h2>
              <p className="text-sm sm:text-base leading-relaxed text-muted-foreground/95">
                {t(steps[activeStep].descKey)}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-6 border-t border-border/30 mt-6">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={activeStep === 0}
            className="rounded-xl px-4 py-2 text-xs font-semibold gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("common.back")}
          </Button>

          <Button
            onClick={nextStep}
            disabled={activeStep === steps.length - 1}
            className="rounded-xl px-4 py-2 text-xs font-semibold bg-accent hover:bg-accent/90 text-white gap-1 transition-colors"
          >
            {t("common.next")}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
