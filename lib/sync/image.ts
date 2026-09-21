export async function compressImage(base64: string, maxW = 1024, quality = 0.7): Promise<Blob> {
  const img = new Image();
  img.src = base64;
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; });
  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), "image/jpeg", quality));
  return blob;
}

// الحاجة الفعلية من عميل Supabase في هذه الدالة — لا نستورد النوع الكامل
// حتى يبقى الملف قابلًا للاختبار بعميل مُقلَّد.
export type StorageClient = {
  storage: {
    from(bucket: string): {
      upload(path: string, file: Blob, opts?: { upsert?: boolean; contentType?: string }): Promise<{ error: unknown }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
};

export async function uploadItemImage(sb: StorageClient, lid: string, base64: string) {
  const blob = await compressImage(base64);
  const path = `${lid}.jpg`;
  const { error } = await sb.storage.from("products").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  return sb.storage.from("products").getPublicUrl(path).data.publicUrl as string;
}
