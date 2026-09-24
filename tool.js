'use strict';
const $=id=>document.getElementById(id), units={mm:0.001,cm:0.01,m:1,km:1000,in:0.0254,ft:0.3048,yd:0.9144,mi:1609.344,nmi:1852};
const groups={architecture:[1,2,5,10,20,25,50,75,100,125,200,250,500,1000],model:[1,2,5,10,24,35,48,72,87],map:[1000,5000,10000,25000,50000,100000,500000]};
const num=id=>{const s=$(id).value.trim().replace(',','.');return s===''?NaN:Number(s)}, fmt=n=>Number.isFinite(n)?new Intl.NumberFormat('es-CL',{maximumFractionDigits:8}).format(n):'—', raw=n=>Number(n.toPrecision(12)).toString(), positive=n=>Number.isFinite(n)&&n>0;
let mode='convert',last='real',ratio=.01,valid=true,copyText='',svgExport='',px=37.7952756,calibrated=false,toastTimer;
function toast(s){$('toast').textContent=s;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2800)}
function printing(){const a=num('fromScale'),b=num('toScale'),f=a/b;if(!positive(a)||!positive(b)||!positive(f)){$('printPct').textContent='—';$('printKind').textContent='Introduce escalas positivas';return}$('printPct').textContent=fmt(f*100)+' %';$('printKind').textContent=(f>1?'Ampliación':f<1?'Reducción':'Sin cambio')+' × '+fmt(f)}for(const id of ['fromScale','toScale'])$(id).oninput=printing;
printing();