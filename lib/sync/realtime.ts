import { createClient } from "@/lib/supabase/client";

export function subscribeRealtime(onChange: () => void) {
  const sb = createClient();
  const ch = sb
    .channel("al-sayed-live", { config: { broadcast: { self: false } } })
    .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, onChange)
    .on("system", { event: "disconnect" }, () => setTimeout(onChange, 1000 + Math.random() * 2000))
    .subscribe();
  return () => { sb.removeChannel(ch); };
}
