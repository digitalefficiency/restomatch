// VR-2 (b): in each table money column every decimal point shares one x within 0.5 px.
const fs=require('fs'),path=require('path');const env={};for(const l of fs.readFileSync(path.join(__dirname,'env'),'utf8').split('\n')){const m=/^export (\w+)='(.*)'$/.exec(l);if(m)env[m[1]]=m[2];}
const {chromium}=require(require.resolve('@playwright/test',{paths:[process.cwd()]}));
const ROUTES=(process.env.ROUTES||'/dashboard/leaks/breakdown,/dashboard/suppliers/ledger,/dashboard/approvals/pay-run,/dashboard/leaks/claims,/dashboard/inbox,/dashboard/recovery').split(',');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const loc of ['he','en'])for(const r of ROUTES){const ctx=await b.newContext({viewport:{width:1440,height:900},storageState:path.join(__dirname,'auth-owner.json')});
await ctx.addCookies([{name:'rm_cookie_consent',value:'necessary',url:env.LAB_URL},{name:'rm_locale',value:loc,url:env.LAB_URL}]);
const p=await ctx.newPage();await p.goto(env.LAB_URL+r);await p.waitForLoadState('networkidle');await p.evaluate(()=>document.fonts.ready);
const res=await p.evaluate(()=>{const out=[];for(const t of document.querySelectorAll('table')){const cols={};for(const tr of t.tBodies[0]?.rows||[]){[...tr.cells].forEach((td,i)=>{const w=document.createTreeWalker(td,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){const s=n.nodeValue;if(!s.includes('₪'))continue;const k=s.lastIndexOf('.');if(k<0)continue;const rg=document.createRange();rg.setStart(n,k);rg.setEnd(n,k+1);const x=rg.getBoundingClientRect();if(x.width)(cols[i]=cols[i]||[]).push(x.left);}});}
for(const [i,xs] of Object.entries(cols))if(xs.length>1)out.push({col:+i,n:xs.length,spread:+(Math.max(...xs)-Math.min(...xs)).toFixed(2)});}return out;});
console.log(JSON.stringify({route:r,loc,cols:res}));await ctx.close();}await b.close();})();
