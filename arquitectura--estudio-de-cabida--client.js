// Public transport/UI only. All study geometry comes from the private API.
let activeDriver=0,revision=0,controller;
const viewIds={plan:'plotCanvas',sec1:'sectionCanvas',secCB:'sectionCanvasCB',sec2:'sectionCanvas2',secDC:'sectionCanvasDC'};
const fields=[...document.querySelectorAll('input[id],select[id]')];
const status=document.getElementById('calculation-status');
const local=['127.0.0.1','localhost'].includes(location.hostname);
const endpoint=local?'/api/cabida/v1':window.CABIDA_API_URL;
function invalidate(message,state='pending'){
 validStudy=false;
 document.querySelectorAll('.export-btn,.export-option').forEach(b=>b.disabled=true);
 for(const key of Object.keys(svgCache))delete svgCache[key];
 for(const key of Object.keys(dxfCache))delete dxfCache[key];
 for(const id of Object.values(viewIds)){const c=document.getElementById(id);c.getContext('2d').clearRect(0,0,c.width,c.height);}
 for(const id of ['areaTerrenoResult','cosResult','ccResult','ccUsageText','ccUsageTextAB','stopExplanation'])document.getElementById(id).textContent='—';
 for(const id of ['usageBarFill','usageBarFillAB'])document.getElementById(id).style.width='0%';
 document.getElementById('resumenProyecto').textContent=message;
 status.textContent=message;status.parentElement.dataset.state=state;
}
function changed(event){
 if(event.target.id.startsWith('angle'))activeDriver=Number(event.target.id.slice(5));
 revision++;controller?.abort();document.getElementById('calculate').disabled=false;
 invalidate('Parámetros modificados. Pulsa «Actualizar estudio» para calcular.');
}
fields.forEach(el=>el.addEventListener('input',changed));
// Explicit calculation avoids consuming a server request for each keystroke.
async function calculateStudy(){
 const current=++revision;controller?.abort();controller=new AbortController();
 invalidate('Calculando estudio…');document.getElementById('errorBox').style.display='none';
 if(!endpoint){invalidate('El generador está pendiente de activación. Vuelve a intentarlo próximamente.','error');return;}
 const inputs={};
 for(const el of fields){
  if(el.type==='number'&&(el.value.trim()===''||!Number.isFinite(Number(el.value)))){invalidate('Completa los valores numéricos antes de calcular.','error');return;}
  inputs[el.id]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
 }
 const button=document.getElementById('calculate');button.disabled=true;
 const timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiVersion:1,activeDriver,inputs}),signal:controller.signal,credentials:'omit'});
  const result=await response.json();
  if(current!==revision)return;
  if(!response.ok)throw new Error(result.error||'No se pudo calcular. Inténtalo de nuevo.');
  if(result.apiVersion!==1)throw new Error('Actualiza la página para usar la nueva versión del generador.');
  for(const [key,view] of Object.entries(result.views)){
   const c=document.getElementById(viewIds[key]);c.width=view.W;c.height=view.H;
   shapesToCanvas(c.getContext('2d'),view.shapes,view.W,view.H);
   svgCache[key]=shapesToSVG(view.shapes,view.W,view.H);dxfCache[key]=shapesToDXF(view.shapes);
  }
  for(const [id,value] of Object.entries(result.texts)){const el=document.getElementById(id);if(el)el.textContent=value;}
  result.angles.forEach((a,i)=>{if(i!==activeDriver)document.getElementById('angle'+i).value=a.toFixed(2);});
  document.getElementById('resumenProyecto').innerHTML=result.summary;
  for(const id of ['usageBarFill','usageBarFillAB'])document.getElementById(id).style.width=result.usage+'%';
  validStudy=true;document.querySelectorAll('.export-btn,.export-option').forEach(b=>b.disabled=false);
  status.textContent='Estudio actualizado · versión '+result.engineVersion;status.parentElement.dataset.state='ready';
 }catch(error){if(current===revision)invalidate(error.name==='AbortError'?'La solicitud tardó demasiado. Vuelve a intentarlo.':error instanceof TypeError?'No se pudo conectar con el cálculo. Revisa tu conexión e inténtalo de nuevo.':error.message,'error');}
 finally{clearTimeout(timer);if(current===revision)button.disabled=false;}
}
document.getElementById('calculate').addEventListener('click',calculateStudy);
document.querySelectorAll('.export-btn').forEach(b=>b.addEventListener('click',()=>b.parentElement.classList.toggle('is-open')));
document.addEventListener('click',e=>{document.querySelectorAll('.export-menu').forEach(m=>{if(!m.contains(e.target)||e.target.classList.contains('export-option'))m.classList.remove('is-open');});});
calculateStudy();
