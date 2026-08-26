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

export async function uploadItemImage(sb: any, lid: string, base64: string) {
  const blob = await compressImage(base64);
  const path = `${lid}.jpg`;
  const { error } = await sb.storage.from("products").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  return sb.storage.from("products").getPublicUrl(path).data.publicUrl as string;
}
