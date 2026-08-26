import { openDB } from "idb";
import type { DbCategory, Invoice } from "./types";

const DB_NAME = "al-sayed-v2";
const STORE_DB = "db";
const STORE_INV = "invoices";
const STORE_OUTBOX = "outbox";

export async function getIDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_DB)) db.createObjectStore(STORE_DB);
      if (!db.objectStoreNames.contains(STORE_INV)) db.createObjectStore(STORE_INV);
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX);
    },
  });
}

export async function saveDB(db: DbCategory[]) {
  const idb = await getIDB();
  await idb.put(STORE_DB, JSON.stringify(db), "current");
  try { localStorage.setItem("al_sayed_db", JSON.stringify(db)); } catch {}
}

export async function loadDB(): Promise<DbCategory[] | null> {
  try {
    const idb = await getIDB();
    const raw = await idb.get(STORE_DB, "current");
    if (raw) return JSON.parse(raw);
  } catch {}
  try {
    const ls = localStorage.getItem("al_sayed_db");
    if (ls) return JSON.parse(ls);
  } catch {}
  return null;
}

export async function saveInvoices(invoices: Invoice[]) {
  const idb = await getIDB();
  await idb.put(STORE_INV, JSON.stringify(invoices), "current");
  try { localStorage.setItem("al_sayed_invoices", JSON.stringify(invoices)); } catch {}
}
