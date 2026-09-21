// ⚖️ T4.3 — صفحة قانونية: الخصوصية (المحتوى في lib/legal/policy.ts)
import { PrivacyView } from "@/app/legal-views";

export const metadata = { title: "الخصوصية — آل السيد" };

export default function Page() {
  return <PrivacyView />;
}
