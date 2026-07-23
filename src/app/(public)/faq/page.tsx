import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
import { FaqAccordion } from "@/components/faq-accordion";

export const metadata: Metadata = { title: "FAQ | Smart Dream" };

export default async function FaqPage() {
  const { t } = await getI18n();

  const FAQ = [
    { q: t("faq.q1"), a: t("faq.a1") },
    { q: t("faq.q2"), a: t("faq.a2") },
    { q: t("faq.q3"), a: t("faq.a3") },
    { q: t("faq.q4"), a: t("faq.a4") },
    { q: t("faq.q5"), a: t("faq.a5") },
    { q: t("faq.q6"), a: t("faq.a6") },
    { q: t("faq.q7"), a: t("faq.a7") },
    { q: t("faq.q8"), a: t("faq.a8") },
    { q: t("faq.q9"), a: t("faq.a9") },
  ];

  return <FaqAccordion faqList={FAQ} />;
}
