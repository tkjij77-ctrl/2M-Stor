// ⚖️ T4.3 — صفحة قانونية: شروط (المحتوى في lib/legal/policy.ts)
import { TermsView } from "@/app/legal-views";

export const metadata = { title: "شروط — آل السيد" };

export default function Page() {
  return <TermsView />;
}
