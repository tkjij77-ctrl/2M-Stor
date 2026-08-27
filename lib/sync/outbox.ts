import { createClient } from "@/lib/supabase/client";
import type { DbItem, DbCategory } from "@/lib/db/types";
import { getQ, getQs, getMin, firstNum } from "@/lib/db/lid";
import { saveDB } from "@/lib/db/indexedDB";

type Entry = { t: string; lid: string; catLid?: string; cid?: number; so?: number; key?: string; value?: string; ts: number };

let outbox: Entry[] = (()=>{ try{ return JSON.parse(typeof localStorage!=="undefined" ? localStorage.getItem("al_sayed_outbox")||"[]" : "[]"); }catch{ return []; }})();
let flushing = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function persist(){ try{ localStorage.setItem("al_sayed_outbox", JSON.stringify(outbox)); }catch{} }
export function queue(entry: Omit<Entry,"ts">){ outbox.push({...entry, ts: Date.now()}); persist(); schedulePush(); }
function schedulePush(){ if(pushTimer) clearTimeout(pushTimer); pushTimer=setTimeout(()=>void flushOutbox(globalDb),500); }
let globalDb: DbCategory[] = [];
export function bindDB(db: DbCategory[]){ globalDb=db; }

function findLocalItem(lid:string, db:DbCategory[]){ for(const c of db) for(const it of c.items) if(it.lid===lid) return it; return null; }
function findLocalCat(lid:string, db:DbCategory[]){ return db.find(c=>c.lid===lid)||null; }
function itemPayload(it:DbItem, cat?:DbCategory|null){
  return { category_id: cat?.cid ?? null, name: it.n, price_text: it.p, price_num: it.pn ?? firstNum(it.p), stock_q: getQ(it), display_qs: getQs(it), min_alert: getMin(it), barcode: it.b||null, image_url: it.imgUrl||null };
}
async function compressDataUrl(dataUrl:string){
  if(typeof window==='undefined' || !dataUrl.startsWith('data:image')) return dataUrl;
  return new Promise<string>(resolve=>{
    const img=new window.Image();
    img.onload=()=>{
      let w=img.width, h=img.height, maxW=1024;
      if(w>maxW){ h=Math.round(h*maxW/w); w=maxW; }
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d')!.drawImage(img,0,0,w,h);
      try{ resolve(c.toDataURL('image/jpeg',0.7)); }catch{ resolve(dataUrl); }
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}
async function uploadImage(item:DbItem, sb:ReturnType<typeof createClient>){
  if(!item.img || typeof window==='undefined') return null;
  try{
    let dataUrl=item.img;
    if(dataUrl.startsWith('data:image')) dataUrl=await compressDataUrl(dataUrl);
    const blob=await (await fetch(dataUrl)).blob();
    const path=item.lid+'.jpg';
    const {error}=await sb.storage.from('products').upload(path, blob, {upsert:true, contentType:'image/jpeg'});
    if(error) return null;
    return sb.storage.from('products').getPublicUrl(path).data.publicUrl;
  }catch{ return null; }
}
export async function flushOutbox(db:DbCategory[] = globalDb){
  if(flushing || outbox.length===0) return;
  const sb=createClient();
  flushing=true;
  // batch للـ item-ins
  const batch = outbox.filter(e=>e.t==='item-ins');
  if(batch.length>1){
    // حاول batch واحد
  }
  while(outbox.length>0){
    const e=outbox.shift()!; persist();
    try{ await applyEntry(e, db, sb); }catch{ outbox.unshift(e); persist(); flushing=false; return; }
  }
  flushing=false; persist();
  await pullAll(db);
}
async function applyEntry(e:Entry, db:DbCategory[], sb:ReturnType<typeof createClient>){
  if(e.t==='cat-ins'){
    const c=findLocalCat(e.lid, db); if(!c||c.cid) return;
    const {data,error}=await sb.from('categories').insert({name:c.name, sort_order:e.so||0}).select().single();
    if(error) throw error; c.cid=data.id; c._ts=data.updated_at;
  } else if(e.t==='cat-upd'){
    const c=findLocalCat(e.lid, db); if(!c||!c.cid) return;
    const {error}=await sb.from('categories').update({name:c.name}).eq('id',c.cid); if(error) throw error;
  } else if(e.t==='cat-del'){
    if(!e.cid) return; const {error}=await sb.from('categories').delete().eq('id',e.cid); if(error) throw error;
  } else if(e.t==='item-ins'){
    const it=findLocalItem(e.lid, db); if(!it||it.cid) return;
    const cat=findLocalCat(e.catLid||'', db);
    if(cat && !cat.cid && outbox.some(o=>o.t==='cat-ins' && o.lid===e.catLid)){ outbox.push(e); return; }
    if(it.img && !it.imgUrl) it.imgUrl=await uploadImage(it,sb) || it.imgUrl;
    const {data,error}=await sb.from('items').insert(itemPayload(it, cat)).select().single();
    if(error) throw error; it.cid=data.id; it._ts=data.updated_at;
  } else if(e.t==='item-upd'){
    const it=findLocalItem(e.lid, db); if(!it) return;
    if(!it.cid){ queue({t:'item-ins', lid:it.lid, catLid:e.catLid}); return; }
    const cat=findLocalCat(e.catLid||'', db);
    if(it.img && !it.imgUrl) it.imgUrl=await uploadImage(it,sb) || it.imgUrl;
    const {error}=await sb.from('items').update(itemPayload(it, cat)).eq('id',it.cid); if(error) throw error;
  } else if(e.t==='item-del'){
    if(!e.cid) return; const {error}=await sb.from('items').delete().eq('id',e.cid); if(error) throw error;
  } else if(e.t==='set'){
    const {error}=await sb.from('settings').upsert({key:e.key!, value:e.value!}); if(error) throw error;
  }
}
export async function pullAll(db:DbCategory[]){
  const sb=createClient();
  const [catsR, itemsR] = await Promise.all([sb.from('categories').select('*'), sb.from('items').select('*')]);
  if(catsR.error) throw catsR.error;
  // merge كما في index.html:3327
  const aliveCats=new Set(catsR.data.filter((r:any)=>!r.deleted_at).map((r:any)=>r.id));
  for(let i=db.length-1;i>=0;i--) if(db[i].cid && !aliveCats.has(db[i].cid)) db.splice(i,1);
  for(const rc of catsR.data as any[]){
    if(rc.deleted_at) continue;
    let lc=db.find(c=>c.cid===rc.id);
    if(!lc){ db.push({name:rc.name, lid:'L'+rc.id, cid:rc.id, _ts:rc.updated_at, items:[]}); }
    else if(rc.updated_at && (!lc._ts || rc.updated_at>lc._ts)){ lc.name=rc.name; lc._ts=rc.updated_at; }
  }
  const aliveItems=new Set(itemsR.data.filter((r:any)=>!r.deleted_at).map((r:any)=>r.id));
  for(const c of db) for(let i=c.items.length-1;i>=0;i--) if(c.items[i].cid && !aliveItems.has(c.items[i].cid)) c.items.splice(i,1);
  for(const ri of itemsR.data as any[]){
    if(ri.deleted_at) continue;
    let owner=null, local=null;
    for(const c of db) for(const it of c.items) if(it.cid===ri.id){ owner=c; local=it; break; }
    if(!local){
      const cat=db.find(c=>c.cid===ri.category_id); if(!cat) continue;
      cat.items.push({n:ri.name, p:ri.price_text, pn:ri.price_num, q:ri.stock_q, qs:ri.display_qs, min:ri.min_alert, b:ri.barcode||'', img:ri.image_url||'', imgUrl:ri.image_url||'', lid:'L'+ri.id, cid:ri.id, _ts:ri.updated_at});
    } else if(ri.updated_at && (!local._ts || ri.updated_at>local._ts)){
      local.n=ri.name; local.p=ri.price_text; local.pn=ri.price_num; local.q=ri.stock_q; local.qs=ri.display_qs;
    }
  }
  await saveDB(db);
}
