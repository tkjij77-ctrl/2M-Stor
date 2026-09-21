// BarcodeDetector ناتيف 2026 — 60fps بدل jsQR (needlecode 2026-01-26)

// أنواع الحدود الخارجية: كلاهما API متصفح غير موجود في lib.dom
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = new (opts: { formats: string[] }) => {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
};
type JsQRResult = { data: string };
type JsQR = (data: Uint8ClampedArray, width: number, height: number) => JsQRResult | null;

export async function detectBarcode(video: HTMLVideoElement): Promise<string[]> {
  try {
    const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorLike }).BarcodeDetector;
    if (BD) {
      const detector = new BD({ formats: ["code_128", "qr_code", "ean_13", "ean_8", "upc_a"] });
      const barcodes = await detector.detect(video);
      return barcodes.map((b) => b.rawValue).filter(Boolean);
    }
  } catch {}
  return [];
}
// Fallback jsQR للـ QR فقط (المكتبة المحلية vendor/jsqr.min.js)
export async function detectQRFromImageData(data: ImageData): Promise<string | null> {
  try {
    const jsQR = (window as unknown as { jsQR?: JsQR }).jsQR;
    if (!jsQR) return null;
    const code = jsQR(data.data, data.width, data.height);
    return code ? code.data : null;
  } catch { return null; }
}
