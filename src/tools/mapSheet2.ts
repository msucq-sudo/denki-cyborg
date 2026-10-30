// 2階（サイボーグ改造室）の平面図だけのページ（mapsheet2.html）。図は mapsheet/floor2.ts（mapsheet.html の「研究所2階」タブと共通）
import { createFloor2Sheet } from './mapsheet/floor2';

const sheet = createFloor2Sheet();
const old = document.getElementById('sheet') as HTMLCanvasElement;
sheet.canvas.id = 'sheet';
sheet.canvas.style.cssText = old.style.cssText;
old.replaceWith(sheet.canvas);

(document.getElementById('save') as HTMLButtonElement).onclick = () => {
  const a = document.createElement('a');
  a.download = sheet.fileName;
  a.href = sheet.canvas.toDataURL('image/png');
  a.click();
};
(window as any).__sheetReady = true;
