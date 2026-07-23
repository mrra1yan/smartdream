import { PageMotion } from "@/components/ui/motion-wrapper";

export default function Template({ children }: { children: React.ReactNode }) {
  return <PageMotion>{children}</PageMotion>;
}
