import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // ✅ إصلاح: لازم alias "@" — بدونه اختبارات tests/unit لا تُستورد أصلًا
  resolve: {
    alias: { "@": path.resolve(__dirname, "./") },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
