import { createSupabaseClient } from "@/lib/supabase/client";
import type { DbCategory } from "@/lib/db/types";

export function subscribeRealtime(db: DbCategory[], onChange: () => void) {
  const sb = createSupabaseClient();
  const channel = sb
    .channel("db-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => onChange())
    .subscribe();
  return () => { sb.removeChannel(channel); };
}
