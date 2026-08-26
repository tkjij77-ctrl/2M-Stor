// كان getDefaultDB() في index.html:1058 — الآن module مستقل
import type { Db } from "./types";
import { genLid } from "./lid";

export function getDefaultDB(): Db {
  // سيتم استيراد البيانات الفعلية من lib/db/seed.json المولد من index.html
  // مؤقتاً يعاد تصدير نفس البيانات لتطابق index.html الحالي
  const raw = require("./seed.json") as { name: string; items: { n:string; p:string; q:number; qs:number }[] }[];
  return raw.map(c => ({
    name: c.name,
    lid: genLid(),
    items: c.items.map(it => ({ ...it, min: 5, b: "", img: "", imgUrl: "", lid: genLid() })),
  }));
}
