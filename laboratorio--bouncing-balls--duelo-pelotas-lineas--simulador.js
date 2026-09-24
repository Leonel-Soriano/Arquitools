
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('simCanvas'), ctx = canvas.getContext('2d'), arena = $('arena');
const config = {initialSpeed:4,bounceForce:1,ballRadius:8,growthPerBounce:1,containerSizeFactor:.42,startingLines:8,volume:1.5,noteSequence:[],ballAColor:'#ff5252',ballBColor:'#00e5ff',lineAColor:'#ff5252',lineBColor:'#00e5ff',lineAWidth:1.5,lineBWidth:1.5,ballAImage:null,ballBImage:null,showTimer:true,timerMode:'countdown',countdownStart:60,gravity:true,randomLines:false,linesMin:1,linesMax:4};
let width=1,height=1,center={x:0,y:0},containerRadius=1,balls=[],particles=[],globalBounceCount=0;
let elapsed=0,isFinished=false,winnerId=null,paused=false,lastFrame=null,accumulator=0;
const STEP=1/120, MAX_SPEED=900, MAX_LINES=400, MAX_PARTICLES=280;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function parseNotes(text) {
  const tokens=text.trim().split(/[\s,;–—-]+/).filter(Boolean);
  if(!tokens.length || tokens.length>256) throw Error('Escribe entre 1 y 256 notas.');
  const semitones={do:0,re:2,mi:4,fa:5,sol:7,la:9,si:11,c:0,d:2,e:4,f:5,g:7,a:9,b:11};
  return tokens.map(token=>{
    const m=/^(do|re|mi|fa|sol|la|si|[a-g])([#♯b♭]?)([1-7]?)$/i.exec(token);
    if(!m) throw Error('Nota no válida: '+token+'. Ejemplos: re, RE#, sib, fa5.');
    const accidental=m[2]==='#'||m[2]==='♯'?1:m[2]? -1:0;
    // Uppercase solfege names select the upper octave; letter notation stays conventional.
    // An explicit octave always takes precedence over letter case.
    const defaultOctave=m[1].length>1&&m[1]===m[1].toUpperCase()?5:4;
    const midi=(Number(m[3]||defaultOctave)+1)*12+semitones[m[1].toLowerCase()]+accidental;
    return 440*Math.pow(2,(midi-69)/12);
  });
}
function applyNotes(event){if(event)stopPreview();try{const notes=parseNotes($('in-notes').value);config.noteSequence=notes;globalBounceCount=0;$('note-status').textContent=notes.length+' notas aplicadas.';$('in-notes').setAttribute('aria-invalid','false');}catch(e){$('note-status').textContent=e.message+' Se conserva la última secuencia.';$('in-notes').setAttribute('aria-invalid','true');}}
$('apply-notes').addEventListener('click',applyNotes);applyNotes();
Object.assign(config,{wave:'triangle',pitch:0,attack:3,decay:180,brightness:9000,metal:0,metalRatio:2.75});
let audioCtx=null,master=null,limiter=null,audioEnabled=false,wantsAudio=true,waitingStart=true,lastSound=-Infinity;
const voices=new Set();
let previewTimers=[],previewActive=false,previewWasPaused=false,previewVersion=0;
function stopSounds(){for(const voice of [...voices])voice.stop();lastSound=-Infinity;}
function stopPreview(){previewVersion++;for(const timer of previewTimers)clearTimeout(timer);previewTimers=[];stopSounds();if(previewActive){paused=previewWasPaused;previewActive=false;lastFrame=null;accumulator=0;updateStatus();}}
function audioStatus(){
  audioEnabled=!!(wantsAudio&&audioCtx&&audioCtx.state==='running');
  $('audio-status').textContent=!wantsAudio?'Audio silenciado':audioEnabled?'Audio listo · sin eco':'Pulsa «Activar audio» o interactúa con la página para habilitarlo.';
  $('btn-sound').textContent=wantsAudio&&audioEnabled?'Silenciar audio':'Activar audio';
  if(audioEnabled&&waitingStart){waitingStart=false;$('audio-start').hidden=true;lastFrame=null;accumulator=0;}
}
function syncVolume(){if(master)master.gain.setTargetAtTime(wantsAudio?config.volume:0,audioCtx.currentTime,.01);}
async function enableAudio(){
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Audio no disponible');
    if(!audioCtx){
      audioCtx=new Audio();master=audioCtx.createGain();
      const compressor=audioCtx.createDynamicsCompressor();compressor.threshold.value=-8;compressor.knee.value=5;compressor.ratio.value=12;compressor.attack.value=.002;compressor.release.value=.12;
      // Smooth, bounded transfer curve after compression; peak output remains below full scale.
      limiter=audioCtx.createWaveShaper();const curve=new Float32Array(4097);for(let i=0;i<curve.length;i++)curve[i]=.95*Math.tanh(2*(i/(curve.length-1)*2-1));limiter.curve=curve;limiter.oversample='2x';
      master.connect(compressor);compressor.connect(limiter);limiter.connect(audioCtx.destination);master.gain.value=wantsAudio?config.volume:0;
      audioCtx.addEventListener('statechange',audioStatus);
    }
    // Call resume on each user gesture, even if an earlier autoplay attempt is still pending.
    const resume=audioCtx.resume();audioStatus();await resume;syncVolume();audioStatus();return audioEnabled;
  }catch{$('audio-status').textContent='Audio no disponible. Reintenta o inicia sin sonido.';$('start-help').textContent='No se pudo activar el audio. Puedes reintentar o iniciar sin sonido.';return false;}
}
function startSilent(){wantsAudio=false;waitingStart=false;stopPreview();syncVolume();audioStatus();$('audio-start').hidden=true;lastFrame=null;accumulator=0;}
$('start-audio').addEventListener('click',()=>{wantsAudio=true;enableAudio();});
$('start-silent').addEventListener('click',startSilent);
$('btn-sound').addEventListener('click',()=>{if(wantsAudio&&audioEnabled){wantsAudio=false;stopPreview();syncVolume();audioStatus();}else{wantsAudio=true;enableAudio();}});
function unlockFromGesture(e){if(e.target.closest&&e.target.closest('#btn-sound,#start-silent,#start-audio,#test-sound'))return;if(wantsAudio&&!audioEnabled)enableAudio();}
for(const event of ['pointerdown','pointerup','keydown'])document.addEventListener(event,unlockFromGesture);
function playBounceSound(force=1,previewFrequency=null){
  if(!audioEnabled||!audioCtx||audioCtx.state!=='running'||config.volume===0)return false;
  const now=audioCtx.currentTime;if(previewFrequency===null&&now-lastSound<.018)return false;
  // Steal the oldest voice instead of dropping the next note of the melody.
  if(voices.size>=12)voices.values().next().value.stop();
  const frequency=(previewFrequency===null?config.noteSequence[globalBounceCount%config.noteSequence.length]:previewFrequency)*Math.pow(2,config.pitch/12);
  const freq=clamp(frequency,20,audioCtx.sampleRate*.42);
  const osc=audioCtx.createOscillator(),gain=audioCtx.createGain(),filter=audioCtx.createBiquadFilter();
  osc.type=config.wave;osc.frequency.value=freq;filter.type='lowpass';filter.frequency.value=Math.min(config.brightness,audioCtx.sampleRate*.45);filter.Q.value=.5;
  const attack=config.attack/1000,decay=config.decay/1000,end=now+attack+decay;
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.24*clamp(force,.5,1.5),now+attack);gain.gain.exponentialRampToValueAtTime(.0001,end);
  osc.connect(filter);filter.connect(gain);gain.connect(master);
  let mod=null,modGain=null;
  if(config.metal>0){mod=audioCtx.createOscillator();modGain=audioCtx.createGain();mod.frequency.value=Math.min(freq*config.metalRatio,audioCtx.sampleRate*.42);modGain.gain.setValueAtTime(freq*config.metal/100*2.5,now);modGain.gain.exponentialRampToValueAtTime(.001,end);mod.connect(modGain);modGain.connect(osc.frequency);}
  let stopped=false;
  const voice={stop(){if(stopped)return;stopped=true;try{osc.stop();if(mod)mod.stop();}catch{}osc.disconnect();filter.disconnect();gain.disconnect();if(mod){mod.disconnect();modGain.disconnect();}voices.delete(voice);}};
  voices.add(voice);osc.onended=()=>voice.stop();osc.start(now);osc.stop(end+.008);if(mod){mod.start(now);mod.stop(end+.008);}
  if(previewFrequency===null){globalBounceCount++;lastSound=now;}return true;
}
$('test-sound').addEventListener('click',async()=>{
  stopPreview();const version=previewVersion;wantsAudio=true;const ready=await enableAudio();if(!ready||version!==previewVersion)return;
  previewWasPaused=paused;previewActive=true;paused=true;stopSounds();updateStatus();
  const notes=config.noteSequence.slice(0,32),spacing=Math.max(.2,(config.attack+config.decay)/1000+.025);
  notes.forEach((frequency,i)=>{previewTimers.push(setTimeout(()=>{if(version===previewVersion)playBounceSound(1,frequency);},i*spacing*1000));});
  previewTimers.push(setTimeout(()=>{if(version===previewVersion)stopPreview();},notes.length*spacing*1000));
});
$('stop-preview').addEventListener('click',stopPreview);
$('in-wave').addEventListener('change',e=>{if(['sine','triangle','square','sawtooth'].includes(e.target.value))config.wave=e.target.value;});
for(const [id,key,min,max,suffix] of [['pitch','pitch',-24,24,' st'],['attack','attack',1,100,' ms'],['decay','decay',30,1200,' ms'],['brightness','brightness',200,16000,' Hz'],['metal','metal',0,100,'%'],['metal-ratio','metalRatio',.5,8,'']])bindNumber('in-'+id,key,min,max,'val-'+id,n=>n+suffix);
// Browsers permitting autoplay start immediately; others display the one-gesture start screen.
enableAudio();

function ballColorOf(b){return config['ball'+b.id+'Color'];}
function lineColorOf(b){return config['line'+b.id+'Color'];}
function lineWidthOf(b){return config['line'+b.id+'Width'];}
function imageOf(b){return config['ball'+b.id+'Image'];}
function anchorAt(angle){return{x:center.x+Math.cos(angle)*containerRadius,y:center.y+Math.sin(angle)*containerRadius};}
function maxRadius(){return Math.max(.1,containerRadius*.30);}
function makeBall(id,x,y){const a=Math.random()*Math.PI*2;return{id,x,y,vx:Math.cos(a)*config.initialSpeed*60,vy:Math.sin(a)*config.initialSpeed*60,radius:Math.min(config.ballRadius,maxRadius()),trail:[],anchors:Array.from({length:config.startingLines},()=>anchorAt(Math.random()*Math.PI*2)),hasBounced:config.startingLines>0};}
function projectInside(b){const dx=b.x-center.x,dy=b.y-center.y,d=Math.hypot(dx,dy),limit=Math.max(0,containerRadius-b.radius-.01);if(d>limit){b.x=center.x+(dx/(d||1))*limit;b.y=center.y+(dy/(d||1))*limit;}}
function resizeCanvas(){
  const rect=arena.getBoundingClientRect(),oldCenter=center,oldRadius=containerRadius;
  width=Math.max(1,rect.width);height=Math.max(1,rect.height);center={x:width/2,y:height/2};
  containerRadius=Math.max(1,Math.min(width*.5-10,height*.5-56,Math.min(width,height)*config.containerSizeFactor));
  const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  const scale=containerRadius/oldRadius;
  for(const b of balls){b.x=center.x+(b.x-oldCenter.x)*scale;b.y=center.y+(b.y-oldCenter.y)*scale;b.radius=Math.min(b.radius*scale,maxRadius());b.trail=[];for(const a of b.anchors){const angle=Math.atan2(a.y-oldCenter.y,a.x-oldCenter.x);Object.assign(a,anchorAt(angle));}projectInside(b);}
  particles=[];
}
resizeCanvas();window.addEventListener('resize',resizeCanvas);
function initSimulation(){stopPreview();resetContactHistory();balls=[makeBall('A',center.x-containerRadius*.36,center.y),makeBall('B',center.x+containerRadius*.36,center.y)];particles=[];elapsed=0;isFinished=false;winnerId=null;globalBounceCount=0;accumulator=0;lastFrame=null;stopSounds();$('btn-reset').textContent='Reiniciar Duelo';updateStatus();updateScores();}
function updateStatus(){ $('match-status').textContent=isFinished?$('btn-reset').dataset.result||'Duelo finalizado':document.hidden?'Pausa automática':paused?'En pausa':''; $('btn-pause').textContent=paused?'Continuar':'Pausar';$('btn-pause').disabled=isFinished;}
function finish(result,winner=null){isFinished=true;winnerId=winner;$('btn-reset').dataset.result=result;$('btn-reset').textContent='Reiniciar Duelo';updateStatus();}
function createSparks(x,y,color,force=1){for(let i=0;i<10 && particles.length<MAX_PARTICLES;i++){const a=Math.random()*Math.PI*2,s=(Math.random()*160+40)*clamp(force,.3,2);particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,radius:Math.random()*2+1,color,life:1});}}
function limitSpeed(b){const speed=Math.hypot(b.vx,b.vy);if(speed>MAX_SPEED){b.vx*=MAX_SPEED/speed;b.vy*=MAX_SPEED/speed;}}
function addLines(b,angle){const n=config.randomLines?config.linesMin+Math.floor(Math.random()*(config.linesMax-config.linesMin+1)):1;for(let i=0;i<n&&b.anchors.length<MAX_LINES;i++)b.anchors.push(anchorAt(config.randomLines?Math.random()*Math.PI*2:angle));b.hasBounced=true;}
let pairContact=false,lastPairAxis=null,repeatedFrontals=0,cycleCorrections=0;
function resetContactHistory(){pairContact=false;lastPairAxis=null;repeatedFrontals=0;cycleCorrections=0;}
function growOnImpact(b){b.radius=Math.min(maxRadius(),b.radius+config.growthPerBounce);}
function stepBoundaryCollision(b){
  const dx=b.x-center.x,dy=b.y-center.y,d=Math.hypot(dx,dy);if(d+b.radius<containerRadius-.3)b.wallContact=false;if(d+b.radius<containerRadius)return;
  const nx=d?dx/d:1,ny=d?dy/d:0,dot=b.vx*nx+b.vy*ny;
  if(dot>0){b.vx-=(1+config.bounceForce)*dot*nx;b.vy-=(1+config.bounceForce)*dot*ny;limitSpeed(b);if(!b.wallContact){b.wallContact=true;growOnImpact(b);addLines(b,Math.atan2(ny,nx));playBounceSound(config.bounceForce);createSparks(center.x+nx*containerRadius,center.y+ny*containerRadius,ballColorOf(b),config.bounceForce);}}
  projectInside(b);
}
function resolveBallCollision(a,b){
  const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),sum=a.radius+b.radius;
  if(d>sum+.3)pairContact=false;if(d>=sum)return;
  const nx=d>1e-9?dx/d:1,ny=d>1e-9?dy/d:0,overlap=sum-d+.001;
  a.x-=nx*overlap/2;a.y-=ny*overlap/2;b.x+=nx*overlap/2;b.y+=ny*overlap/2;
  const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
  if(relative<-.001){
    const newImpact=!pairContact;pairContact=true;
    const impulse=-(1+config.bounceForce)*relative/2;a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;
    if(newImpact){
      const rvx=b.vx-a.vx,rvy=b.vy-a.vy,speed=Math.hypot(rvx,rvy),tangent=-rvx*ny+rvy*nx;
      const frontal=speed>1&&Math.abs(tangent)<speed*.18;
      repeatedFrontals=frontal?(lastPairAxis&&Math.abs(nx*lastPairAxis.x+ny*lastPairAxis.y)>.985?repeatedFrontals+1:1):0;
      lastPairAxis={x:nx,y:ny};
      if(repeatedFrontals>=3){
        // Slight surface roughness only on a repeating frontal orbit. Rotate relative
        // velocity, preserving center-of-mass velocity and collision kinetic energy.
        const angle=(cycleCorrections%2===0?1:-1)*Math.PI/18;
        const outX=speed*(nx*Math.cos(angle)-ny*Math.sin(angle)),outY=speed*(ny*Math.cos(angle)+nx*Math.sin(angle));
        const cx=(a.vx+b.vx)/2,cy=(a.vy+b.vy)/2;
        a.vx=cx-outX/2;a.vy=cy-outY/2;b.vx=cx+outX/2;b.vy=cy+outY/2;
        cycleCorrections++;repeatedFrontals=0;
      }
      growOnImpact(a);growOnImpact(b);
      const extra=(a.radius+b.radius-sum)/2;a.x-=nx*extra;a.y-=ny*extra;b.x+=nx*extra;b.y+=ny*extra;
      if(config.randomLines){addLines(a,0);addLines(b,0);}playBounceSound(config.bounceForce*.7);createSparks((a.x+b.x)/2,(a.y+b.y)/2,'#ffffff');
    }
    limitSpeed(a);limitSpeed(b);
  }
}
function pointSegmentDistance(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,len=dx*dx+dy*dy,t=len?clamp(((px-x1)*dx+(py-y1)*dy)/len,0,1):0;return Math.hypot(px-x1-t*dx,py-y1-t*dy);}
function cutOpponentLines(attacker,defender){let write=0;const radius=attacker.radius+lineWidthOf(defender)/2;for(const a of defender.anchors){if(pointSegmentDistance(attacker.x,attacker.y,a.x,a.y,defender.x,defender.y)>radius)defender.anchors[write++]=a;}defender.anchors.length=write;}
function update(dt){
  if(isFinished)return;
  // Small spatial steps bound motion to half the smallest radius, including both moving endpoints.
  const minRadius=Math.min(...balls.map(b=>b.radius));
  const substeps=Math.max(1,Math.ceil(MAX_SPEED*dt/Math.max(.05,minRadius*.5)));const h=dt/substeps;
  for(let i=0;i<substeps&&!isFinished;i++){
    for(const b of balls){if(config.gravity)b.vy+=792*h;limitSpeed(b);b.x+=b.vx*h;b.y+=b.vy*h;stepBoundaryCollision(b);}
    for(let pass=0;pass<4;pass++){resolveBallCollision(balls[0],balls[1]);for(const b of balls)projectInside(b);}
    cutOpponentLines(balls[0],balls[1]);cutOpponentLines(balls[1],balls[0]);elapsed+=h;
    const lost=balls.map(b=>b.hasBounced&&b.anchors.length===0);
    if(lost[0]&&lost[1])finish('Empate: ambas pelotas se quedaron sin líneas.');
    else if(lost[0]||lost[1]){const winner=balls[lost[0]?1:0].id;finish('Pelota '+winner+' gana.',winner);}
    else if(config.timerMode==='countdown'&&elapsed>=config.countdownStart){elapsed=config.countdownStart;finish('Tiempo agotado · Duelo sin ganador.');}
  }
  for(const b of balls){b.trail.push({x:b.x,y:b.y});if(b.trail.length>30)b.trail.shift();}
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt*2;if(p.life<=0)particles.splice(i,1);}
}
function updateScores(){for(const b of balls){const el=$('score-'+b.id.toLowerCase()),text='Pelota '+b.id+': '+b.anchors.length+' líneas';if(el.textContent!==text)el.textContent=text;el.style.color=ballColorOf(b);}}
function loop(timestamp){
  if(lastFrame===null)lastFrame=timestamp;
  if(!waitingStart&&!paused&&!document.hidden&&!isFinished){accumulator+=Math.min(.1,Math.max(0,(timestamp-lastFrame)/1000));while(accumulator>=STEP&&!isFinished){update(STEP);accumulator-=STEP;}}
  lastFrame=timestamp;updateScores();draw();requestAnimationFrame(loop);
}
$('btn-reset').addEventListener('click',initSimulation);
$('btn-pause').addEventListener('click',()=>{stopPreview();paused=!paused;lastFrame=null;accumulator=0;stopSounds();updateStatus();});
document.addEventListener('visibilitychange',()=>{lastFrame=null;accumulator=0;if(document.hidden)stopPreview();else if(wantsAudio)enableAudio();updateStatus();});
function bindNumber(id,key,min,max,display,format,restart=false,integer=false){const el=$(id);const read=()=>{const raw=el.value.trim();const n=Number(raw);if(raw===''||!Number.isFinite(n)){el.value=config[key];return;}config[key]=clamp(integer?Math.round(n):n,min,max);el.value=config[key];if(display)$(display).textContent=format(config[key]);};el.addEventListener('input',()=>{if(el.type==='range')read();});el.addEventListener('change',()=>{read();if(restart)initSimulation();});}
bindNumber('in-speed','initialSpeed',1,12,'val-speed',String,true);
bindNumber('in-boost','bounceForce',.2,3,'val-boost',n=>n.toFixed(1)+'x');
bindNumber('in-ball-size','ballRadius',3,25,'val-ball-size',n=>n+'px',true,true);
bindNumber('in-start-lines','startingLines',0,80,null,null,true,true);
bindNumber('in-growth','growthPerBounce',0,4,'val-growth',n=>n.toFixed(1)+'px');
bindNumber('in-vol','volume',0,4,'val-vol',n=>Math.round(n*100)+'%');
$('in-vol').addEventListener('input',syncVolume);
bindNumber('in-countdown-start','countdownStart',5,300,null,null,true,true);
for(const suffix of ['a','b']){
  for(const type of ['ball','line'])$('in-'+type+'-'+suffix+'-color').addEventListener('input',e=>{config[type+suffix.toUpperCase()+'Color']=e.target.value;});
  bindNumber('in-line-'+suffix+'-width','line'+suffix.toUpperCase()+'Width',.5,6,'val-line-'+suffix+'-width',String);
}
$('in-container-size').addEventListener('input',e=>{config.containerSizeFactor=clamp(Number(e.target.value),25,48)/100;$('val-container-size').textContent=Math.round(config.containerSizeFactor*100)+'%';resizeCanvas();});
for(const [id,key] of [['in-gravity','gravity'],['in-random-lines','randomLines'],['in-show-timer','showTimer']])$(id).addEventListener('change',e=>{config[key]=e.target.checked;});
function lineRange(){let lo=clamp(Math.round(Number($('in-lines-min').value)||1),1,20),hi=clamp(Math.round(Number($('in-lines-max').value)||1),1,20);[lo,hi]=[Math.min(lo,hi),Math.max(lo,hi)];config.linesMin=lo;config.linesMax=hi;$('in-lines-min').value=lo;$('in-lines-max').value=hi;}
$('in-lines-min').addEventListener('change',lineRange);$('in-lines-max').addEventListener('change',lineRange);
$('in-timer-mode').addEventListener('change',e=>{config.timerMode=e.target.value;$('countdown-config-group').hidden=config.timerMode!=='countdown';initSimulation();});
function loadImageFor(id,key){let version=0;const input=$(id);const remove=document.createElement('button');remove.type='button';remove.textContent='Quitar imagen';input.after(remove);remove.addEventListener('click',()=>{version++;config[key]=null;input.value='';});input.addEventListener('change',()=>{const current=++version,file=input.files[0];if(!file)return;if(!['image/png','image/jpeg'].includes(file.type)||file.size>8*1024*1024){$('image-status').textContent='Selecciona un PNG/JPG de hasta 8 MB.';input.value='';return;}const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);if(current!==version)return;if(img.width*img.height>24000000){$('image-status').textContent='La imagen supera los 24 megapíxeles.';return;}const small=document.createElement('canvas');const scale=Math.min(1,512/Math.max(img.width,img.height));small.width=Math.max(1,Math.round(img.width*scale));small.height=Math.max(1,Math.round(img.height*scale));small.getContext('2d').drawImage(img,0,0,small.width,small.height);config[key]=small;$('image-status').textContent='Imagen aplicada.';};img.onerror=()=>{URL.revokeObjectURL(url);if(current===version)$('image-status').textContent='No se pudo leer la imagen.';};img.src=url;});}
loadImageFor('in-image-a','ballAImage');loadImageFor('in-image-b','ballBImage');

    function drawBall(ball) {
      const color = ballColorOf(ball);
      const img = imageOf(ball);

      ctx.save();
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      ctx.fillStyle = color;
      ctx.fillRect(ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);

      if (img) {
        const size = ball.radius * 2;
        const imgAspect = img.width / img.height;
        let drawW, drawH;
        if (imgAspect > 1) { drawH = size; drawW = size * imgAspect; }
        else { drawW = size; drawH = size / imgAspect; }
        ctx.drawImage(img, ball.x - drawW / 2, ball.y - drawH / 2, drawW, drawH);
      } else {
        ctx.shadowBlur = 12;
        ctx.shadowColor = color;
        ctx.fill();
      }
      ctx.restore();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    function draw() {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      ctx.lineCap = 'round';
      ctx.strokeStyle = '#3a3f55';
      ctx.lineWidth = 6;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#3a3f55';
      ctx.beginPath();
      ctx.arc(center.x, center.y, containerRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      for (const ball of balls) {
        if (ball.anchors.length === 0) continue;
        ctx.strokeStyle = lineColorOf(ball);
        ctx.lineWidth = lineWidthOf(ball);
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        for (const a of ball.anchors) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(ball.x, ball.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      for (const ball of balls) {
        const color = ballColorOf(ball);
        for (let i = 0; i < ball.trail.length; i++) {
          const pt = ball.trail[i];
          const alpha = (i + 1) / ball.trail.length;
          ctx.fillStyle = color;
          ctx.globalAlpha = alpha * 0.35;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, ball.radius * (alpha * 0.8), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1.0;

      for (const ball of balls) drawBall(ball);

      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;



      if (config.showTimer) {
        let elapsedSeconds = elapsed;

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 26px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';

        if (config.timerMode === 'countdown') {
          let remaining = Math.max(0, Math.ceil(config.countdownStart - elapsedSeconds));
          ctx.fillText(remaining, center.x, height - 18);
        } else {
          ctx.fillText(elapsedSeconds.toFixed(1) + " s", center.x, height - 18);
        }
      }
    }


initSimulation(); new ResizeObserver(resizeCanvas).observe(arena); requestAnimationFrame(loop);
