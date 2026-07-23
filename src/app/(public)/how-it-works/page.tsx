import type { Metadata } from "next";
import { HowItWorksStepper } from "@/components/how-it-works-stepper";

export const metadata: Metadata = { title: "How It Works | Smart Dream" };

export default function HowItWorksPage() {
  return <HowItWorksStepper />;
}
