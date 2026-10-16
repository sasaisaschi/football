import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import './style.css';
import { createStadium } from './stadium';
import { loadFootballer, updateFootballer } from './player-visuals';
import { BALL, applyBallDrag, createBall, placeBall } from './ball';
import { PITCH, createPitchPhysics, goalSide, outOfPlay } from './pitch';
import { createPitchVisuals } from './pitch-visuals';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App element missing');
app.innerHTML = `
  <header><div><h1>THE 12TH MAN / MATCHDAY</h1><p>LIVE FROM THE ARENA · AUTONOMOUS FOOTBALL</p></div>
  <div class="actions"><button id="attack">HOHES PRESSING</button><button id="defend">TIEF STEHEN</button><button id="camera">TV-KAMERA</button><button id="sound">STADIONTON AN</button><button id="pause">PAUSE</button><button id="reset">NEUSTART</button></div></header>
  <main id="viewport"><div class="broadcast"><span class="live-pill">● LIVE</span><span class="team-name home">ORANGE CITY</span><span id="score" class="broadcast-score">0 : 0</span><span class="team-name away">BLUE UNITED</span><span id="clock" class="match-clock">00:00</span></div><div class="match-info"><span>EXHIBITION · 3 VS 3</span><span id="speed">BALL 0.0 M/S</span><span id="contacts">SHOTS 0</span></div><div class="goal-flash" id="goal-flash">GOOOAL!</div>
  <div class="events" id="events"><b>MATCH INTELLIGENCE · LIVE</b><div id="feed">Anpfiff folgt …</div></div><div class="status" id="status">Initialisiere Stadion …</div></main>`;

const status = document.querySelector<HTMLElement>('#status')!;
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const clockLabel = document.querySelector<HTMLElement>('#clock')!;
const speedLabel = document.querySelector<HTMLElement>('#speed')!;
const contactLabel = document.querySelector<HTMLElement>('#contacts')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const attackButton = document.querySelector<HTMLButtonElement>('#attack')!;
const defendButton = document.querySelector<HTMLButtonElement>('#defend')!;
const cameraButton = document.querySelector<HTMLButtonElement>('#camera')!;
const feed = document.querySelector<HTMLElement>('#feed')!;
const soundButton=document.querySelector<HTMLButtonElement>('#sound')!;
const goalFlash=document.querySelector<HTMLElement>('#goal-flash')!;

async function start(): Promise<void> {
  await RAPIER.init();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#081322');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  camera.position.set(0, 28, 72);
  camera.lookAt(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;
  viewport.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x24402b, 2.2));
  const sunlight = new THREE.DirectionalLight(0xffffff, 2.4);
  sunlight.position.set(-20, 65, 25);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -90; sunlight.shadow.camera.right = 90;
  sunlight.shadow.camera.top = 90; sunlight.shadow.camera.bottom = -90;
  scene.add(sunlight);

  const stadium=createStadium(scene);
  // A continuous opening sequence: stadium establishing shot, teams, pitch, kickoff.
  const intro=document.createElement('div');intro.className='match-intro';intro.innerHTML='<div class="intro-eyebrow">THE 12TH MAN · MATCHDAY</div><div class="intro-title">THIS IS OUR HOME.</div><div class="intro-subtitle">THE STADIUM IS ALIVE · KICKOFF APPROACHING</div><div class="intro-progress"><span></span></div>';
  viewport.append(intro);
  const introDuration=16;
  let introTime=0;
  let introFinished=false;
  const startCamera=new THREE.Vector3(-150,60,160);
  const endCamera=new THREE.Vector3(0,28,72);
  camera.position.copy(startCamera);camera.lookAt(0,5,0);
  const introSkip=document.createElement('button');introSkip.className='intro-skip';introSkip.textContent='ZUM ANPFIFF →';intro.append(introSkip);
  introSkip.addEventListener('click',()=>{introTime=introDuration;});
  createPitchVisuals(scene);

  // Rendering: Y up. Physics: Y up. Football length along X, width along Z.
  const world = new RAPIER.World({x:0,y:-9.81,z:0});
  world.timestep = 1/60;
  createPitchPhysics(world);
  const ballRadius = BALL.radius;
  const ball = createBall(world);
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(ballRadius,24,16),new THREE.MeshStandardMaterial({color:'#f5f5ee',roughness:.5}));
  ballMesh.castShadow=true;scene.add(ballMesh);
  type Player = { body:RAPIER.RigidBody; mesh:THREE.Group; color:string; kicks:number; cooldown:number; initial:[number,number]; team:number; number:number; visual?:Awaited<ReturnType<typeof loadFootballer>> };
  const players: Player[] = [];
  for(const [i,x,z,color] of [[0,-30,-17,'#ff913d'],[1,-20,0,'#ff913d'],[2,-30,17,'#ff913d'],[3,30,-17,'#52caff'],[4,20,0,'#52caff'],[5,30,17,'#52caff']] as const) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,.9,z).lockRotations().setLinearDamping(2));
    world.createCollider(RAPIER.ColliderDesc.capsule(.52,.32).setMass(75).setFriction(.9).setRestitution(0),body);
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({color,roughness:.75});
    const skin=new THREE.MeshStandardMaterial({color:i%2?'#9b6546':'#d7a47b',roughness:.85});
    const shorts=new THREE.MeshStandardMaterial({color:i<3?'#171e35':'#e6e9f2',roughness:.8});
    const boots=new THREE.MeshStandardMaterial({color:'#0c1220',roughness:.55});
    function limb(w:number,h:number,d:number,xp:number,yp:number,zp:number,mat:THREE.Material){
      const part=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);part.position.set(xp,yp,zp);part.castShadow=true;group.add(part);return part;
    }
    const torso=new THREE.Mesh(new THREE.BoxGeometry(.64,.72,.34),material);
    torso.position.y=1.36;torso.castShadow=true;group.add(torso);
    limb(.65,.26,.36,0,.9,0,shorts);
    limb(.17,.55,.18,-.2,.48,0,skin);limb(.17,.55,.18,.2,.48,0,skin);
    limb(.22,.16,.35,-.2,.13,.09,boots);limb(.22,.16,.35,.2,.13,.09,boots);
    limb(.16,.62,.18,-.43,1.31,0,skin);limb(.16,.62,.18,.43,1.31,0,skin);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),skin);
    head.position.y=1.89;head.castShadow=true;group.add(head);
    const hair=new THREE.Mesh(new THREE.SphereGeometry(.195,12,8,0,Math.PI*2,0,Math.PI*.4),new THREE.MeshStandardMaterial({color:i%3===0?'#21130c':'#2c2522'}));
    hair.position.y=1.93;group.add(hair);
    const number=document.createElement('canvas');number.width=64;number.height=64;
    const ctx=number.getContext('2d')!;ctx.fillStyle='white';ctx.font='bold 42px Arial';ctx.textAlign='center';ctx.fillText(String(i+1),32,47);
    const decal=new THREE.Mesh(new THREE.PlaneGeometry(.3,.3),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(number),transparent:true,depthWrite:false,side:THREE.DoubleSide}));
    decal.position.set(0,1.4,-.18);group.add(decal);
    scene.add(group);
    players.push({body,mesh:group,color,kicks:0,cooldown:0,initial:[x,z],team:i<3?0:1,number:i+1});
  }

  // Replace placeholder geometry only after a complete rigged GLB has loaded successfully.
  void Promise.all(players.map(async p=>{
    const visual=await loadFootballer(p.team,p.number);
    if(!visual)return;
    p.visual=visual;
    p.mesh.clear();
    p.mesh.add(visual.root);
  }));
  let paused=false, time=0, contacts=0, accumulator=0, previous=performance.now();
  let soundEnabled=false, audio:AudioContext|null=null, noise:AudioBufferSourceNode|null=null, crowdGain:GainNode|null=null;
  function playGoalHorn(){if(!audio||!soundEnabled)return;for(const hz of [330,440,550]){const osc=audio.createOscillator(),g=audio.createGain();osc.type='sawtooth';osc.frequency.value=hz;g.gain.setValueAtTime(.0001,audio.currentTime);g.gain.exponentialRampToValueAtTime(.045,audio.currentTime+.1);g.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+1.6);osc.connect(g).connect(audio.destination);osc.start();osc.stop(audio.currentTime+1.7);}}
  soundButton.addEventListener('click',()=>{if(!audio){audio=new AudioContext();const buffer=audio.createBuffer(1,audio.sampleRate*3,audio.sampleRate);const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.2;noise=audio.createBufferSource();noise.buffer=buffer;noise.loop=true;const low=audio.createBiquadFilter();low.type='lowpass';low.frequency.value=420;crowdGain=audio.createGain();crowdGain.gain.value=.06;noise.connect(low).connect(crowdGain).connect(audio.destination);noise.start();}soundEnabled=!soundEnabled;void audio.resume();if(crowdGain)crowdGain.gain.value=soundEnabled?.11:0;soundButton.textContent=soundEnabled?'STADIONTON AUS':'STADIONTON AN';});
  let orange=0, blue=0, tacticalMode:'attack'|'defend'='attack', cameraMode=0, lastFeedTime=-10;
  const events:string[]=[];
  function logEvent(message:string):void {
    events.unshift(`${time.toFixed(1)}s · ${message}`);
    if(events.length>7)events.length=7;
    feed.innerHTML=events.map(e=>`<div>${e}</div>`).join('');
  }
  attackButton.addEventListener('click',()=>{tacticalMode='attack';logEvent('Trainer: offensives Pressing');});
  defendButton.addEventListener('click',()=>{tacticalMode='defend';logEvent('Trainer: kompakte Defensive');});
  cameraButton.addEventListener('click',()=>{cameraMode=(cameraMode+1)%3;});
  const scoreLabel=document.querySelector<HTMLElement>('#score')!;
  let kickoffDelay=0;
  let lastContactText='Agenten suchen den Ball. Physik bestimmt das Ergebnis.';
  const velocity = new THREE.Vector3();
  function reset(): void {
    placeBall(ball,0,0);
    players.forEach(p=>{
      p.body.setTranslation({x:p.initial[0],y:.9,z:p.initial[1]},true);
      p.body.setLinvel({x:0,y:0,z:0},true);
      p.cooldown=0;p.kicks=0;
    });
    time=0;contacts=0;accumulator=0;orange=0;blue=0;kickoffDelay=0;events.length=0;logEvent('Anpfiff: 3 gegen 3');
    lastContactText='Neustart: sechs Agenten reagieren auf den Ball.';
  }
  pauseButton.addEventListener('click',()=>{paused=!paused;pauseButton.textContent=paused?'Fortsetzen':'Pause';});
  resetButton.addEventListener('click',reset);

  function kickoff():void {
    placeBall(ball,0,0);
    players.forEach(p=>{
      p.body.setTranslation({x:p.initial[0],y:.9,z:p.initial[1]},true);
      p.body.setLinvel({x:0,y:0,z:0},true);
      p.cooldown=1;
    });
    kickoffDelay=1.2;
  }
  function step(dt:number): void {
    const b=ball.translation();
    kickoffDelay=Math.max(0,kickoffDelay-dt);
    for(const p of players) {
      p.cooldown=Math.max(0,p.cooldown-dt);
      const pos=p.body.translation(), vel=p.body.linvel();
      const dx=b.x-pos.x,dz=b.z-pos.z, distance=Math.hypot(dx,dz);
      const teammates=players.filter(q=>q.team===p.team);
      const rank=teammates.filter(q=>{
        const a=q.body.translation();
        return Math.hypot(b.x-a.x,b.z-a.z)<distance;
      }).length;
      // Closest agent presses; supporting players hold passing lanes.
      const attack=p.team===0?1:-1;
      const anchor=tacticalMode==='defend' ? (p.team===0?-10:10) : b.x-attack*(3+rank*2);
      const targetX=rank===0?b.x:Math.max(-PITCH.halfLength+2,Math.min(PITCH.halfLength-2,anchor));
      const targetZ=rank===0?b.z:Math.max(-PITCH.halfWidth+2,Math.min(PITCH.halfWidth-2,b.z+(p.initial[1]<0?-1:1)*(3+rank)));
      const tx=targetX-pos.x,tz=targetZ-pos.z, d=Math.hypot(tx,tz);
      const maxSpeed=tacticalMode==='attack'?7.5:5.5, maxAcceleration=10;
      const desiredSpeed=Math.min(maxSpeed,Math.max(0,d-.45)*2.4);
      const vx=d>.001?tx/d*desiredSpeed:0, vz=d>.001?tz/d*desiredSpeed:0;
      const ax=(vx-vel.x)/dt, az=(vz-vel.z)/dt;
      const length=Math.hypot(ax,az);
      const factor=length>maxAcceleration?maxAcceleration/length:1;
      const mass=p.body.mass();
      p.body.applyImpulse({x:ax*factor*mass*dt,y:0,z:az*factor*mass*dt},true);
      // Possession decision: controlled passes and genuine shots are distinct events.
      if(distance<.82 && b.y<.55 && p.cooldown<=0 && kickoffDelay===0) {
        const direction=p.team===0?1:-1;
        const goalDistance=PITCH.halfLength-direction*b.x;
        const defenders=players.filter(q=>q.team!==p.team);
        const pressure=defenders.some(q=>{
          const o=q.body.translation();
          return Math.hypot(o.x-pos.x,o.z-pos.z)<3;
        });
        const options=teammates.filter(q=>q!==p).map(q=>{
          const o=q.body.translation();
          const advance=(o.x-pos.x)*direction;
          const clearance=Math.min(...defenders.map(d=>{
            const v=d.body.translation();return Math.hypot(v.x-o.x,v.z-o.z);
          }));
          return {q,o,score:advance*.5+clearance*.8-Math.hypot(o.x-pos.x,o.z-pos.z)*.12};
        }).sort((a,b)=>b.score-a.score);
        const shot=goalDistance<11 && Math.abs(b.z)<8 && (!pressure || goalDistance<5);
        let impulseX:number,impulseZ:number,impulseY:number;
        let action:string;
        if(shot) {
          const targetZ=Math.max(-1.5,Math.min(1.5,-b.z*.18));
          const dx=direction*goalDistance,dz=targetZ-b.z;
          const norm=Math.hypot(dx,dz)||1;
          impulseX=dx/norm*4.1;impulseZ=dz/norm*4.1;impulseY=.45;
          contacts++;
          action='Torschuss';
        } else if(options.length && (pressure || options[0].score>1.5)) {
          const target=options[0].o;
          const dx=target.x-b.x,dz=target.z-b.z;
          const norm=Math.hypot(dx,dz)||1;
          impulseX=dx/norm*2.2;impulseZ=dz/norm*2.2;impulseY=.12;
          action='Pass';
        } else {
          impulseX=direction*.95;impulseZ=Math.max(-.5,Math.min(.5,-b.z*.06));impulseY=.04;
          action='Dribbling';
        }
        ball.applyImpulse({x:impulseX,y:impulseY,z:impulseZ},true);
        p.cooldown=action==='Dribbling'?.65:1.2;
        lastContactText=`#${p.number} (${p.team===0?'Orange':'Blau'}): ${action} · ${time.toFixed(1)} s`;
        if(action!=='Dribbling')logEvent(`${p.team===0?'ORANGE':'BLAU'} #${p.number}: ${action}`);
      }
    }
    applyBallDrag(ball);
    world.step();
    time+=dt;
    const ballNow=ball.translation();
    const scored=goalSide(ballNow);
    if(scored!==0) {
      if(scored>0)orange++;else blue++;
      lastContactText=`TOR! Orange ${orange} : ${blue} Blau — Anstoß folgt.`;
      logEvent(`TOR! ${ballNow.x>0?'ORANGE':'BLAU'} · ${orange}:${blue}`);
      goalFlash.classList.add('active');goalFlash.textContent=ballNow.x>0?'ORANGE CITY SCORES!':'BLUE UNITED SCORES!';playGoalHorn();
      kickoff();
    } else if(outOfPlay(ballNow)) {
      lastContactText='Ausball: neuer Anstoß (Einwurf-Regeln folgen).';
      if(time-lastFeedTime>1){logEvent('Ball im Aus · neuer Anstoß');lastFeedTime=time;}
      kickoff();
    }
  }

  function resize():void {
    const w=viewport.clientWidth,h=viewport.clientHeight;
    if(w<=0||h<=0)return;
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport);resize();
  function frame(now:number):void {
    const elapsed=Math.min((now-previous)/1000,.1);previous=now;
    if(!paused && !introFinished){
      introTime=Math.min(introDuration,introTime+elapsed);
      const t=introTime/introDuration;
      intro.style.opacity=String(Math.min(1,Math.max(0,(1-t)*5)));
      const progress=intro.querySelector<HTMLElement>('.intro-progress span');if(progress)progress.style.width=`${t*100}%`;
      if(t>=1){introFinished=true;intro.remove();logEvent('Anpfiff – das Spiel beginnt!');}
    }
    if(!paused && introFinished) {
      accumulator+=elapsed;
      let steps=0;
      while(accumulator>=1/60&&steps<6){step(1/60);accumulator-=1/60;steps++;}
      if(steps===6)accumulator=0;
    }
    const bp=ball.translation(),br=ball.rotation();
    ballMesh.position.set(bp.x,bp.y,bp.z);
    ballMesh.quaternion.set(br.x,br.y,br.z,br.w);
    players.forEach(p=>{
      const v=p.body.translation(), lv=p.body.linvel();
      p.mesh.position.set(v.x,v.y-.9,v.z);
      if(Math.hypot(lv.x,lv.z)>.1)p.mesh.rotation.y=Math.atan2(lv.x,lv.z);
      if(p.visual)updateFootballer(p.visual,elapsed,Math.hypot(lv.x,lv.z),p.cooldown);
    });
    const v=ball.linvel();velocity.set(v.x,v.y,v.z);
    clockLabel.textContent=`${String(Math.floor(time/60)).padStart(2,'0')}:${String(Math.floor(time%60)).padStart(2,'0')}`;
    if(goalFlash.classList.contains('active')&&kickoffDelay===0)goalFlash.classList.remove('active');
    if(crowdGain&&soundEnabled)crowdGain.gain.value=.08+Math.min(.16,Math.abs(bp.x)/PITCH.halfLength*.16);
    speedLabel.textContent=`BALL ${velocity.length().toFixed(1)} M/S`;
    contactLabel.textContent=`TORSCHÜSSE ${contacts}`;
    scoreLabel.textContent=`${orange} : ${blue}`;
    status.textContent=lastContactText;
    if(!introFinished){
      const t=Math.min(1,introTime/introDuration),smooth=t*t*(3-2*t);
      camera.position.copy(startCamera).lerp(endCamera,smooth);
      camera.lookAt(0,5*(1-smooth),0);
    }
    else if(cameraMode===0){camera.position.lerp(new THREE.Vector3(bp.x*.6,28,72),.03);camera.lookAt(bp.x*.85,0,bp.z*.3);}
    else if(cameraMode===1){camera.position.lerp(new THREE.Vector3(bp.x-12,12,bp.z+17),.04);camera.lookAt(bp.x,0,bp.z);}
    else{camera.position.lerp(new THREE.Vector3(0,110,.1),.035);camera.lookAt(0,0,0);}
    stadium.update(time,Math.min(1,Math.abs(bp.x)/PITCH.halfLength));
    renderer.render(scene,camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
start().catch(error=>{status.textContent=`Startfehler: ${String(error)}`;console.error(error);});
