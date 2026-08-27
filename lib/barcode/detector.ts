// BarcodeDetector ناتيف 2026 — 60fps بدل jsQR (needlecode 2026-01-26)
export async function detectBarcode(video: HTMLVideoElement): Promise<string[]> {
  try {
    const BD: any = (window as any).BarcodeDetector;
    if (BD) {
      const detector = new BD({ formats: ["code_128", "qr_code", "ean_13", "ean_8", "upc_a"] });
      const barcodes = await detector.detect(video);
      return barcodes.map((b: any) => b.rawValue).filter(Boolean);
    }
  } catch {}
  return [];
}
// Fallback jsQR للـ QR فقط (موجود index.html:9)
export async function detectQRFromImageData(data: ImageData): Promise<string | null> {
  try {
    const jsQR: any = (window as any).jsQR;
    if (!jsQR) return null;
    const code = jsQR(data.data, data.width, data.height);
    return code ? code.data : null;
  } catch { return null; }
}
