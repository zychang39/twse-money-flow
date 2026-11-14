/**
 * 截圖文字辨識（2026-11-14；DECISIONS #464）：在使用者的裝置上執行（tesseract.js，WebAssembly），圖片不上傳、不儲存。
 * 檔案自託管在 ./ocr/（build/ocr-assets.ts），用到時才下載（約 8 MB，之後由瀏覽器快取）。
 *
 * 兩個做法讓它又快又準（以真實的券商庫存截圖實測）：
 * 1. 先把圖轉成灰階；深色畫面反白成白底黑字（深色畫面直接辨識會把 8028 讀成 3028）。
 * 2. 先用英數模型找代號（約 1 秒，10／10），先給結果；再用繁中模型讀名稱，跟代號互相核對。
 */
import type { Worker } from 'tesseract.js';

const BASE = `${import.meta.env.BASE_URL}ocr/`;
const MAX_WIDTH = 1300;
const workers = new Map<string, Promise<Worker>>();

async function worker(lang: 'eng' | 'chi_tra'): Promise<Worker> {
  let w = workers.get(lang);
  if (!w) {
    w = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const made = await createWorker(lang, 1, { workerPath: `${BASE}worker.min.js`, corePath: BASE, langPath: BASE, gzip: true });
      await made.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return made;
    })();
    workers.set(lang, w);
    w.catch(() => workers.delete(lang));
  }
  return w;
}

/** 灰階；平均亮度偏暗（深色畫面）就反白；太寬的圖縮小。回傳畫布（給辨識引擎）。 */
export async function prepareImage(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('這個瀏覽器不支援影像處理');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
    sum += y;
  }
  if (sum / (d.length / 4) < 128) {
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface OcrText { text: string; words: { text: string; x: number; y: number }[] }

type Box = { x0: number; x1: number; y0: number; y1: number };
function pack(data: { text: string; words?: { text: string; bbox: Box }[] }, width: number, height: number): OcrText {
  return {
    text: data.text,
    words: (data.words ?? []).map((w) => ({ text: w.text, x: (w.bbox.x0 + w.bbox.x1) / 2 / width, y: (w.bbox.y0 + w.bbox.y1) / 2 / height })),
  };
}

/**
 * 辨識一張截圖：英數（代號）與繁中（名稱）兩段同時跑，各自完成就呼叫 onText（文字＋每個字的位置）。
 * 代號通常先回來，畫面先列出結果；名稱那一段失敗不影響代號（只是少了核對）。
 */
export async function recognizeScreenshot(file: Blob, onText: (kind: 'codes' | 'names', result: OcrText) => void): Promise<void> {
  const canvas = await prepareImage(file);
  const run = async (lang: 'eng' | 'chi_tra', kind: 'codes' | 'names') => {
    const w = await worker(lang);
    onText(kind, pack((await w.recognize(canvas)).data, canvas.width, canvas.height));
  };
  const names = run('chi_tra', 'names').catch(() => undefined); // 名稱核對是輔助：模型載入失敗時只用代號
  await run('eng', 'codes');
  await names;
}

/** 面板關閉時釋放辨識引擎（各占數十 MB 記憶體） */
export async function disposeOcr(): Promise<void> {
  const all = [...workers.values()];
  workers.clear();
  await Promise.all(all.map((w) => w.then((x) => x.terminate()).catch(() => undefined)));
}
