# المزامنة — من polling إلى Realtime

## القديم (index.html:3213)
- `schedulePush 1500ms` + `pullAll 30s` polling
- `outbox` في localStorage + `flushOutbox` واحدة واحدة

## الجديد
- `lib/sync/outbox.ts`: `500ms` debounce + batch `insert(...).select()`
- `lib/sync/realtime.ts`: `sb.channel('db-changes').on('postgres_changes', ...)` → تحديث فوري <1ث
- `lib/db/indexedDB.ts`: `idb` بدل localStorage (حد 5MB)
- `lib/sync/image.ts`: ضغط `canvas.toBlob(0.7, 1024px)` قبل `storage.from('products').upload`

## guard
- `dbIsFactory:1047` — جهاز مصنع لا يرفع `qs=0` للسحابة، بل يسحب فقط
