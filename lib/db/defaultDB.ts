// كان getDefaultDB() في index.html:1058 — الآن module مستقل
import type { Db } from "./types";
import { genLid } from "./lid";
// استيراد JSON ساكن (كان require() ويكسر ESLint/الشجرة الثابتة)
import raw from "./seed.json";

type SeedCategory = { name: string; items: { n: string; p: string; q: number; qs: number }[] };

export function getDefaultDB(): Db {
  return (raw as SeedCategory[]).map((c: SeedCategory) => ({
    name: c.name,
    lid: genLid(),
    items: c.items.map(it => ({ ...it, min: 5, b: "", img: "", imgUrl: "", lid: genLid() })),
  }));
}
