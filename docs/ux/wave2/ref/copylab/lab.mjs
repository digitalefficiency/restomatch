import { createRequire } from 'node:module';
const require = createRequire('/home/user/restomatch/package.json');
const { chromium } = require('/home/user/restomatch/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core');
const fmt = (v, o={}) => new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:o.d??0}).format(v);
const cases = [
  ['A hero plain', `<p>${fmt(760)}</p>`],
  ['B activity span dir=auto lang=he', `<p class="truncate"><span>שטיינברג</span><span> · </span><span lang="he" dir="auto">${fmt(2788)} כולל מע״מ</span></p>`],
  ['C activity loss dir=auto', `<p><span lang="he" dir="auto">הפסד פוטנציאלי ${fmt(105)}</span></p>`],
  ['D count 1 plural', `<p>1 מוצרים עלו במחיר מעל הסף שהגדרתם.</p>`],
  ['E ask driver +amount', `<p>הגידול הגדול ביותר אצל תנובה (+${fmt(1234)}).</p>`],
  ['F alerts range money', `<p>${fmt(12.5,{d:2})} – ${fmt(14.9,{d:2})}</p>`],
  ['G chain legend 3%+', `<p>3%+</p>`],
  ['H WhatsApp template raw', `<p>הוא ₪14.9 במקום ₪12.5 שסוכם — פער של ₪2.4 ליחידה.</p>`],
  ['I quote latin supplier', `<p>שלום, בהזמנה מ"Coca-Cola Ltd." הפריט קולה זירו (24 יח׳) לא הגיע.</p>`],
  ['J PO plural', `<p>צפויים 2 POs</p>`],
  ['K inventory formula', `<p>מלאי פתיחה ${fmt(12000)} + קניות ${fmt(48270)} − זיכויים שהתקבלו ${fmt(464)} − מלאי סגירה ${fmt(11500)} = ${fmt(48306)}</p>`],
  ['L maqaf ₪0', `<p>3 חשבוניות בלי סכום לפני מע״מ נספרו כ-₪0.</p>`],
];
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>body{font:16px Heebo,Arial;width:760px} .row{border-bottom:1px solid #ddd;padding:6px} .lbl{font:11px monospace;color:#666;direction:ltr;text-align:left}</style></head><body>${cases.map(([l,h])=>`<div class="row"><div class="lbl">${l}</div>${h}</div>`).join('')}</body></html>`;
import fs from 'node:fs';
fs.writeFileSync(new URL('./lab.html', import.meta.url), html);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 2 });
await p.setContent(html);
const res = await p.evaluate(() => [...document.querySelectorAll('.row')].map(row => {
  const para = row.querySelector('p'); const w = document.createTreeWalker(para, NodeFilter.SHOW_TEXT); const chars=[]; let n;
  while((n=w.nextNode())){ for(let i=0;i<n.data.length;i++){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+1); const rc=r.getBoundingClientRect(); const ch=n.data[i]; if(rc.width===0||/[‎‏]/.test(ch)) continue; chars.push([rc.left, ch===' '||ch===' '?'·':ch]); } }
  chars.sort((a,b)=>a[0]-b[0]); return row.querySelector('.lbl').textContent+'  =>  ['+chars.map(c=>c[1]).join('')+']';
}));
console.log(res.join('\n'));
await p.screenshot({ path: new URL('./lab.png', import.meta.url).pathname, fullPage: true });
await b.close();
