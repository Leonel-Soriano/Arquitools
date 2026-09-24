
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('simCanvas');
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;
const STEP = 1 / 120;
const GRAVITY = 792; // Original 0.22 px/frame² at 60 Hz, now units/second².
const MAX_SPEED = 1200;
const MAX_BALL_RADIUS = 35, MAX_RING_WIDTH = 20;
const config = { numCircles:16, initialSpeed:4, bounceForce:1, ballRadius:12, volume:0.5,
  ringWidth:7, particleCount:14, particleColor:'#ff5252',
  backgroundColor:'#000000', ballColor:'#ff5252', ringColor:'#20b2aa', trailColor:'#ffffff', showTimer:true,
  timerMode:'countdown', countdownStart:60, ballImage:null };
let ball, rings=[], particles=[], elapsed=0, result='', paused=false;
let accumulator=0, lastFrame=null, trailClock=0;
let view={width:1,height:1,scale:1,x:0,y:0,dpr:1};
const mod = n => ((n % TAU) + TAU) % TAU;
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));

// Physics uses world coordinates: resizing only changes the camera.
function resizeCanvas() {
  const rect = $('stage').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1,2);
  view.width=Math.max(1,rect.width); view.height=Math.max(1,rect.height); view.dpr=dpr;
  canvas.width=Math.round(view.width*dpr); canvas.height=Math.round(view.height*dpr);
  const extent=(rings.at(-1)?.radius || 350)+MAX_BALL_RADIUS+MAX_RING_WIDTH/2+25;
  view.scale=Math.max(0.001,Math.min((view.width-20)/(extent*2),(view.height-110)/(extent*2)));
  view.x=view.width/2; view.y=Math.max(1,(view.height-90)/2);
}
new ResizeObserver(resizeCanvas).observe($('stage'));
window.addEventListener('resize',resizeCanvas);

let audioCtx=null, master=null, lastSound=-Infinity;
const voices=new Set();
const notes=[261.63,293.66,329.63,392,440,523.25,587.33,659.25,783.99,880];
async function initAudio() {
  if(config.volume===0) return;
  try {
    const Audio=window.AudioContext || window.webkitAudioContext;
    if(!Audio) { $('audio-status').textContent='Audio no disponible en este navegador.'; return; }
    if(!audioCtx) { audioCtx=new Audio(); master=audioCtx.createGain(); master.gain.value=config.volume; master.connect(audioCtx.destination); }
    if(audioCtx.state==='suspended') await audioCtx.resume();
    $('audio-status').textContent=audioCtx.state==='running' ? 'Audio activado' : 'Audio pendiente: vuelve a interactuar.';
  } catch { $('audio-status').textContent='No se pudo activar el audio. La simulación continúa.'; }
}
function silence() {
  for(const voice of voices) { try { voice.stop(); } catch {} }
}
function playBounceSound(index,force) {
  if(!audioCtx || audioCtx.state!=='running' || config.volume===0 || voices.size>=8) return;
  const t=audioCtx.currentTime;
  if(t-lastSound<0.035) return;
  lastSound=t;
  try {
    const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
    osc.frequency.value=notes[index%notes.length];
    gain.gain.setValueAtTime(0.0001,t);
    gain.gain.exponentialRampToValueAtTime(0.12*clamp(force,0.3,2),t+0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001,t+0.18);
    osc.connect(gain); gain.connect(master); voices.add(osc);
    osc.onended=()=>{ osc.disconnect(); gain.disconnect(); voices.delete(osc); };
    osc.start(t); osc.stop(t+0.19);
  } catch { /* A sound failure must never stop physics. */ }
}
document.addEventListener('pointerdown',initAudio);
document.addEventListener('keydown',initAudio);

function initSimulation() {
  const angle=Math.random()*TAU;
  ball={x:0,y:0,vx:Math.cos(angle)*config.initialSpeed*60,vy:Math.sin(angle)*config.initialSpeed*60,radius:config.ballRadius,trail:[]};
  const base=60;
  rings=Array.from({length:config.numCircles},(_,index)=>{
    // Leave room for the whole ball between neighboring strokes. Otherwise
    // simultaneous inner/outer constraints can become geometrically impossible.
    // Keep world layout and camera independent of both size controls. Changing
    // the ball must visibly change its size without rescaling the ring strokes.
    const radius=base+index*(2*MAX_BALL_RADIUS+MAX_RING_WIDTH+4), lineWidth=config.ringWidth;
    return {index,radius,lineWidth,rotation:Math.random()*TAU,speed:(Math.random()<0.5?-1:1)*(0.72+Math.random()*0.9),
      // The full disk must fit between the rounded arc ends, with clearance.
      gapSize:Math.max(0.55,2*Math.asin((ball.radius+lineWidth/2+3)/radius)+0.18),destroyed:false};
  });
  particles=[]; elapsed=0; result=''; accumulator=0; lastFrame=null; trailClock=0;
  silence(); resizeCanvas(); updateHUD();
}
function createSparks(x,y,color,force=1,count=14,kind='ring') {
  const f=clamp(force,0.3,2.5);
  for(let i=0;i<count;i++) {
    const angle=Math.random()*TAU, speed=(60+Math.random()*240)*f;
    particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,radius:(1+Math.random()*2.5)*Math.sqrt(f),color,life:1,kind});
  }
  if(particles.length>500) particles.splice(0,particles.length-500);
}
// Closest point on a circular arc. Its thick stroke is a swept disk,
// so this also detects the rounded end caps and finite ball radius.
function contact(ring) {
  const dist=Math.hypot(ball.x,ball.y), angle=mod(Math.atan2(ball.y,ball.x));
  if(Math.abs(dist-ring.radius)>=ball.radius+ring.lineWidth/2) return null;
  const relative=mod(angle-ring.rotation);
  let qx,qy;
  if(relative>=ring.gapSize) {
    qx=Math.cos(angle)*ring.radius; qy=Math.sin(angle)*ring.radius;
  } else {
    const ax=Math.cos(ring.rotation)*ring.radius, ay=Math.sin(ring.rotation)*ring.radius;
    const bx=Math.cos(ring.rotation+ring.gapSize)*ring.radius, by=Math.sin(ring.rotation+ring.gapSize)*ring.radius;
    if(Math.hypot(ball.x-ax,ball.y-ay)<Math.hypot(ball.x-bx,ball.y-by)) {qx=ax;qy=ay;} else {qx=bx;qy=by;}
  }
  const dx=ball.x-qx, dy=ball.y-qy, distance=Math.hypot(dx,dy);
  const penetration=ball.radius+ring.lineWidth/2-distance;
  if(penetration<=0) return null;
  // A deterministic inward normal avoids division by zero in degenerate contact.
  return {nx:distance>1e-9?dx/distance:-Math.cos(angle),ny:distance>1e-9?dy/distance:-Math.sin(angle),penetration,qx,qy};
}
function limitSpeed() {
  const speed=Math.hypot(ball.vx,ball.vy);
  if(speed>MAX_SPEED) {ball.vx*=MAX_SPEED/speed;ball.vy*=MAX_SPEED/speed;}
}
function finish(message) { result=message; silence(); updateHUD(); }
function update(dt) {
  // Celebration particles keep fading after the simulation has ended.
  for(const p of particles) {p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=1.8*dt;}
  particles=particles.filter(p=>p.life>0);
  if(result) return;
  if(config.timerMode==='countdown') dt=Math.min(dt,Math.max(0,config.countdownStart-elapsed));
  elapsed+=dt;
  const outer=rings.at(-1);
  const nearbyRadius=Math.min(outer.radius,Math.hypot(ball.x,ball.y)+ball.radius+MAX_SPEED*dt+4);
  const maxMotion=Math.hypot(ball.vx,ball.vy)+GRAVITY*dt+nearbyRadius*1.62;
  const substeps=Math.max(1,Math.ceil(maxMotion*dt/Math.min(1.5,ball.radius/3)));
  const h=dt/substeps;
  const sounded=new Set();
  for(let sub=0;sub<substeps;sub++) {
    for(const ring of rings) if(!ring.destroyed) ring.rotation=mod(ring.rotation+ring.speed*h);
    ball.vy+=GRAVITY*h; limitSpeed(); ball.x+=ball.vx*h; ball.y+=ball.vy*h;
    // Sequential constraint passes recompute geometry after each correction.
    for(let pass=0;pass<4;pass++) {
      let any=false;
      for(const ring of rings) {
        if(ring.destroyed) continue;
        const c=contact(ring); if(!c) continue; any=true;
        ball.x+=c.nx*(c.penetration+0.001); ball.y+=c.ny*(c.penetration+0.001);
        // Ring rotation is kinematic: rounded ends can transfer energy.
        const wallVx=-ring.speed*c.qy, wallVy=ring.speed*c.qx;
        const approach=(ball.vx-wallVx)*c.nx+(ball.vy-wallVy)*c.ny;
        if(approach<0) {
          ball.vx-=2*approach*c.nx; ball.vy-=2*approach*c.ny; limitSpeed();
          if(!sounded.has(ring.index) && approach<-15) {
            sounded.add(ring.index); playBounceSound(ring.index,config.bounceForce);
            createSparks(c.qx,c.qy,config.particleColor,config.bounceForce,config.particleCount,'bounce');
          }
        }
      }
      if(!any) break;
    }
    // A layer is cleared only after the entire ball has passed its outer edge.
    const distance=Math.hypot(ball.x,ball.y);
    for(const ring of rings) {
      if(!ring.destroyed && distance>ring.radius+ball.radius+ring.lineWidth/2+0.01) {
        ring.destroyed=true; createSparks(ball.x,ball.y,config.ringColor);
      }
    }
    if(rings.every(r=>r.destroyed)) { finish('¡Escapó con éxito!'); break; }
  }
  trailClock+=dt;
  if(trailClock>=1/60) {trailClock%=1/60;ball.trail.push({x:ball.x,y:ball.y});if(ball.trail.length>15) ball.trail.shift();}
  if(!result && config.timerMode==='countdown' && elapsed>=config.countdownStart-1e-9) {
    elapsed=config.countdownStart; finish('¡Tiempo agotado!');
  }
}
function draw() {
  ctx.setTransform(view.dpr,0,0,view.dpr,0,0); ctx.fillStyle=config.backgroundColor; ctx.fillRect(0,0,view.width,view.height);
  ctx.translate(view.x,view.y); ctx.scale(view.scale,view.scale); ctx.lineCap='round';
  ctx.strokeStyle=config.ringColor;
  for(const r of rings) if(!r.destroyed) {ctx.lineWidth=r.lineWidth;ctx.beginPath();ctx.arc(0,0,r.radius,r.rotation+r.gapSize,r.rotation+TAU);ctx.stroke();}
  ball.trail.forEach((p,i)=>{const a=(i+1)/ball.trail.length;ctx.globalAlpha=a*0.4;ctx.fillStyle=config.trailColor;ctx.beginPath();ctx.arc(p.x,p.y,ball.radius*a*0.8,0,TAU);ctx.fill();});
  ctx.globalAlpha=1;
  ctx.fillStyle=config.ballColor;ctx.beginPath();ctx.arc(ball.x,ball.y,ball.radius,0,TAU);ctx.fill();
  if(config.ballImage) {
    const img=config.ballImage, size=ball.radius*2, scale=size/Math.max(img.naturalWidth,img.naturalHeight);
    ctx.save();ctx.beginPath();ctx.arc(ball.x,ball.y,ball.radius,0,TAU);ctx.clip();
    ctx.drawImage(img,ball.x-img.naturalWidth*scale/2,ball.y-img.naturalHeight*scale/2,img.naturalWidth*scale,img.naturalHeight*scale);ctx.restore();
  }
  for(const p of particles) {ctx.globalAlpha=clamp(p.life,0,1);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,TAU);ctx.fill();}
  ctx.globalAlpha=1;
}
function updateHUD() {
  const timer=$('timer'); timer.hidden=!config.showTimer || config.timerMode==='none';
  const text=config.timerMode==='none'?'':config.timerMode==='countdown'?`${Math.max(0,Math.ceil(config.countdownStart-elapsed))} s`:`${elapsed.toFixed(1)} s`;
  if(timer.textContent!==text) timer.textContent=text;
  const state=result || (paused?'En pausa':document.hidden?'Pausa automática':'En marcha');
  const status=`${state} · ${rings.filter(r=>r.destroyed).length}/${rings.length} aros superados`;
  if($('status').textContent!==status) $('status').textContent=status;
  $('btn-pause').textContent=paused?'Reanudar':'Pausar';
  $('btn-pause').disabled=Boolean(result);
}
function loop(now) {
  if(lastFrame===null) lastFrame=now;
  // Drop excess backlog after stalls; the clock measures simulated active time.
  const delta=Math.min(0.1,Math.max(0,(now-lastFrame)/1000)); lastFrame=now;
  if(!paused && !document.hidden) {
    accumulator+=delta;
    while(accumulator+1e-10>=STEP) {update(STEP);accumulator=Math.max(0,accumulator-STEP);}
  }
  if(view.dpr!==Math.min(window.devicePixelRatio||1,2)) resizeCanvas();
  draw();updateHUD();requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange',()=>{lastFrame=null;accumulator=0;if(document.hidden) silence();updateHUD();});
$('btn-pause').addEventListener('click',()=>{paused=!paused;lastFrame=null;accumulator=0;if(paused) silence();updateHUD();});
$('btn-reset').addEventListener('click',()=>{paused=false;initSimulation();});

function numeric(id,key,display,format,restart) {
  const input=$(id);
  function read(commit) {
    let value=Number(input.value);
    if(!Number.isFinite(value) || input.value.trim()==='') value=config[key];
    value=clamp(value,Number(input.min),Number(input.max));
    const step=Number(input.step)||1;
    value=Number((Math.round(value/step)*step).toFixed(3));
    if(display) $(display).textContent=format(value);
    if(commit) {input.value=value;config[key]=value;if(restart) initSimulation();}
  }
  input.addEventListener('input',()=>read(!restart));
  input.addEventListener('change',()=>read(true));
}
numeric('in-layers','numCircles','val-layers',String,true);
numeric('in-speed','initialSpeed','val-speed',String,true);
numeric('in-ball-size','ballRadius','val-ball-size',v=>v+' u',true);
numeric('in-ring-width','ringWidth','val-ring-width',v=>v+' u',true);
numeric('in-particles','particleCount','val-particles',v=>v===0?'Desactivadas':String(v),false);
$('in-particles').addEventListener('input',()=>{if(config.particleCount===0) particles=particles.filter(p=>p.kind!=='bounce');});
$('in-particle-color').addEventListener('input',e=>{
  config.particleColor=e.target.value;
  for(const p of particles) if(p.kind==='bounce') p.color=config.particleColor;
});
numeric('in-boost','bounceForce','val-boost',v=>v.toFixed(1)+'x',false);
numeric('in-vol','volume','val-vol',v=>Math.round(v*100)+'%',false);
numeric('in-countdown-start','countdownStart',null,String,true);
$('in-vol').addEventListener('input',()=>{
  if(master) master.gain.setValueAtTime(config.volume,audioCtx.currentTime);
  if(config.volume===0) {silence();$('audio-status').textContent='Audio silenciado';} else initAudio();
});
for(const [id,key] of [['in-ball-color','ballColor'],['in-ring-color','ringColor'],['in-trail-color','trailColor']]) $(id).addEventListener('input',e=>config[key]=e.target.value);
$('in-show-timer').addEventListener('change',e=>{config.showTimer=e.target.checked;updateHUD();});
$('in-timer-mode').addEventListener('change',e=>{
  config.timerMode=['none','stopwatch','countdown'].includes(e.target.value)?e.target.value:'countdown';
  $('countdown-config-group').hidden=config.timerMode!=='countdown';
  $('in-show-timer').disabled=config.timerMode==='none';
  initSimulation();
});
let imageVersion=0;
$('in-image').addEventListener('change',async e=>{
  const version=++imageVersion, file=e.target.files[0];
  if(!file) return;
  const status=$('image-status');
  if(!['image/png','image/jpeg'].includes(file.type) || file.size>10*1024*1024) {status.textContent='Usa un PNG o JPG de hasta 10 MB.';e.target.value='';return;}
  const url=URL.createObjectURL(file), img=new Image();
  try {
    img.src=url; await img.decode();
    if(img.naturalWidth*img.naturalHeight>16000000) throw new Error('dimensions');
    if(version===imageVersion) {config.ballImage=img;status.textContent='Imagen cargada; ajustada al círculo de colisión.';}
  } catch {
    if(version===imageVersion) {status.textContent='Imagen no válida o superior a 16 megapíxeles.';e.target.value='';}
  } finally {URL.revokeObjectURL(url);}
});
$('btn-remove-image').addEventListener('click',()=>{imageVersion++;config.ballImage=null;$('in-image').value='';$('image-status').textContent='Imagen eliminada.';});
// Associate all existing visual labels with their controls.
document.querySelectorAll('.control-group').forEach(group=>{const label=group.querySelector('label'),input=group.querySelector('input,select');if(label&&input) label.htmlFor=input.id;});
function setBackground(color){config.backgroundColor=color;$('in-bg-color').value=color;$('stage').style.backgroundColor=color;const r=parseInt(color.slice(1,3),16)/255,g=parseInt(color.slice(3,5),16)/255,b=parseInt(color.slice(5,7),16)/255;const linear=v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);$('stage').style.color=(.2126*linear(r)+.7152*linear(g)+.0722*linear(b))>.179?'#172b28':'#f5f5ef';} $('in-bg-color').addEventListener('input',e=>setBackground(e.target.value));$('btn-bg-reset').addEventListener('click',()=>setBackground('#000000'));setBackground(config.backgroundColor);initSimulation();requestAnimationFrame(loop);

