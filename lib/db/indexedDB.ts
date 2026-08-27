import { openDB } from "idb";
import type { DbCategory, Invoice } from "./types";

const DB_NAME = "al-sayed-v2";
const STORE_DB = "db";
const STORE_INV = "invoices";
const STORE_OUTBOX = "outbox";

export async function getIDBInstance() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_DB)) db.createObjectStore(STORE_DB);
      if (!db.objectStoreNames.contains(STORE_INV)) db.createObjectStore(STORE_INV);
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX);
    },
  });
}
// للتوافق مع useShop: getIDB(key)
export async function getIDB<T = any>(key?: string): Promise<T | null> {
  const store = key === "invoices" ? STORE_INV : key === "outbox" ? STORE_OUTBOX : STORE_DB;
  const id = "current";
  try {
    const idb = await getIDBInstance();
    const raw = await idb.get(store, id);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  try {
    const lsKey = store === STORE_INV ? "al_sayed_invoices" : store === STORE_OUTBOX ? "al_sayed_outbox" : "al_sayed_db";
    const ls = typeof localStorage !== "undefined" ? localStorage.getItem(lsKey) : null;
    if (ls) return JSON.parse(ls) as T;
  } catch {}
  return null;
}
export async function setIDB(key: string, value: any): Promise<void> {
  const store = key === "invoices" ? STORE_INV : key === "outbox" ? STORE_OUTBOX : STORE_DB;
  try {
    const idb = await getIDBInstance();
    await idb.put(store, JSON.stringify(value), "current");
  } catch {}
  try {
    const lsKey = store === STORE_INV ? "al_sayed_invoices" : store === STORE_OUTBOX ? "al_sayed_outbox" : "al_sayed_db";
    if (typeof localStorage !== "undefined") localStorage.setItem(lsKey, JSON.stringify(value));
  } catch {}
}
export async function saveDB(db: DbCategory[]) { return setIDB("db", db); }
export async function loadDB(): Promise<DbCategory[] | null> { return getIDB<DbCategory[]>("db"); }
export async function saveInvoices(invoices: Invoice[]) { return setIDB("invoices", invoices); }
export async function loadInvoices(): Promise<Invoice[] | null> { return getIDB<Invoice[]>("invoices"); }
