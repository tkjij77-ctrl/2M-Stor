export type DbItem = {
  n: string; p: string; pn?: number;
  q: number; qs: number; min: number;
  b?: string; img?: string; imgUrl?: string;
  lid: string; cid?: number; _ts?: string;
};
export type DbCategory = { name: string; lid: string; cid?: number; _ts?: string; sort_order?: number; items: DbItem[] };
export type Db = DbCategory[];
export type Invoice = { lid: string; cid?: number; no: number; date: string; customer: string; user: string; items: { name: string; cat?: string; qty: number; price: number }[]; subtotal: number; discount: number; tax: number; total: number };
