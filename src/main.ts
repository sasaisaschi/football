import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { createStadium } from './stadium';
import { loadFootballer, updateFootballer } from './player-visuals';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App element missing');
app.innerHTML = `
  <header><div><h1>INSIDE THE GAME / CHARACTER PIPELINE 005</h1><p>LIVE FROM THE ARENA · AUTONOMOUS FOOTBALL</p></div>
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
  scene.background = new THREE.Color('#101a32');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(0, 32, 37);
  camera.lookAt(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
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
  const stripes=[0x1e7b46,0x23864c];
  for(let i=0;i<8;i++){
    const strip=new THREE.Mesh(new THREE.PlaneGeometry(5.25,28),new THREE.MeshStandardMaterial({color:stripes[i%2],roughness:1}));
    strip.rotation.x=-Math.PI/2;strip.position.set(-18.375+i*5.25,.014,0);strip.receiveShadow=true;scene.add(strip);
  }
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(48, 34), new THREE.MeshStandardMaterial({ color: '#18673e', roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xe8fff1 });
  function line(points: [number, number][], close = false): void {
    const p = close ? [...points, points[0]] : points;
    const geometry = new THREE.BufferGeometry().setFromPoints(p.map(([x,z]) => new THREE.Vector3(x, .055, z)));
    scene.add(new THREE.Line(geometry, lineMat));
  }
  line([[-21,-14],[21,-14],[21,14],[-21,14]],true);
  line([[0,-14],[0,14]]);
  const circle: [number,number][] = Array.from({length:65},(_,i)=>[4*Math.cos(i*Math.PI/32),4*Math.sin(i*Math.PI/32)]);
  line(circle);
  for (const s of [-1,1]) {
    const goalX = s*21;
    line([[goalX,-6],[goalX-s*6,-6],[goalX-s*6,6],[goalX,6]]);
    line([[goalX,-3.2],[goalX-s*2,-3.2],[goalX-s*2,3.2],[goalX,3.2]]);
    const postMaterial = new THREE.MeshStandardMaterial({color:'#ffffff',metalness:.2,roughness:.4});
    for(const z of [-2.5,2.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,2,10),postMaterial);
      post.position.set(goalX,1,z); scene.add(post);
    }
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,5,10),postMaterial);
    crossbar.rotation.x = Math.PI/2; crossbar.position.set(goalX,2,0); scene.add(crossbar);
  }

  // Rendering: Y up. Physics: Y up. Football length along X, width along Z.
  const world = new RAPIER.World({x:0,y:-9.81,z:0});
  world.timestep = 1/60;
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,-.1,0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(24,.1,17).setFriction(.8),groundBody);
  const ballRadius = .11;
  const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,ballRadius+.02,0).setCcdEnabled(true).setLinearDamping(.13).setAngularDamping(.18));
  world.createCollider(RAPIER.ColliderDesc.ball(ballRadius).setMass(.43).setRestitution(.58).setFriction(.6),ball);
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(ballRadius,24,16),new THREE.MeshStandardMaterial({color:'#f5f5ee',roughness:.5}));
  ballMesh.castShadow=true;scene.add(ballMesh);
  type Player = { body:RAPIER.RigidBody; mesh:THREE.Group; color:string; kicks:number; cooldown:number; initial:[number,number]; team:number; number:number; visual?:Awaited<ReturnType<typeof loadFootballer>> };
  const players: Player[] = [];
  for(const [i,x,z,color] of [[0,-13,-7,'#ff913d'],[1,-10,0,'#ff913d'],[2,-13,7,'#ff913d'],[3,13,-7,'#52caff'],[4,10,0,'#52caff'],[5,13,7,'#52caff']] as const) {
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
    feed.innerHTML=events.map(e=>`<div>${'${'}e}</div>`).join('');
  }
  attackButton.addEventListener('click',()=>{tacticalMode='attack';logEvent('Trainer: offensives Pressing');});
  defendButton.addEventListener('click',()=>{tacticalMode='defend';logEvent('Trainer: kompakte Defensive');});
  cameraButton.addEventListener('click',()=>{cameraMode=(cameraMode+1)%3;});
  const scoreLabel=document.querySelector<HTMLElement>('#score')!;
  let kickoffDelay=0;
  let lastContactText='Agenten suchen den Ball. Physik bestimmt das Ergebnis.';
  const velocity = new THREE.Vector3();
  function reset(): void {
    ball.setTranslation({x:0,y:ballRadius+.02,z:0},true);
    ball.setLinvel({x:0,y:0,z:0},true);ball.setAngvel({x:0,y:0,z:0},true);
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
    ball.setTranslation({x:0,y:ballRadius+.02,z:0},true);
    ball.setLinvel({x:0,y:0,z:0},true);
    ball.setAngvel({x:0,y:0,z:0},true);
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
      const targetX=rank===0?b.x:Math.max(-19,Math.min(19,anchor));
      const targetZ=rank===0?b.z:Math.max(-12,Math.min(12,b.z+(p.initial[1]<0?-1:1)*(3+rank)));
      const tx=targetX-pos.x,tz=targetZ-pos.z, d=Math.hypot(tx,tz);
      const maxSpeed=tacticalMode==='attack'?7.5:5.5, maxAcceleration=10;
      const desiredSpeed=Math.min(maxSpeed,Math.max(0,d-.45)*2.4);
      const vx=d>.001?tx/d*desiredSpeed:0, vz=d>.001?tz/d*desiredSpeed:0;
      const ax=(vx-vel.x)/dt, az=(vz-vel.z)/dt;
      const length=Math.hypot(ax,az);
      const factor=length>maxAcceleration?maxAcceleration/length:1;
      const mass=p.body.mass();
      p.body.applyImpulse({x:ax*factor*mass*dt,y:0,z:az*factor*mass*dt},true);
      // Attempt a physical kick only if close to the live ball.
      if(distance<.72 && b.y<.55 && p.cooldown<=0 && kickoffDelay===0) {
        const towardGoal=p.team===0?1:-1;
        const goalZ=Math.max(-1.5,Math.min(1.5,-b.z*.12));
        const angle=Math.atan2(goalZ-b.z,towardGoal*(21-b.x*towardGoal));
        const power=7.5+Math.min(2,Math.hypot(vel.x,vel.z)*.35);
        const shotX=towardGoal*Math.cos(angle)*power;
        const shotZ=Math.sin(angle)*power;
        ball.applyImpulse({x:shotX*.43,y:.43*(.8+(p.number%3)*.35),z:shotZ*.43},true);
        ball.applyTorqueImpulse({x:0,y:(p.team===0?-.06:.06),z:0},true);
        p.cooldown=.85;contacts++;
        lastContactText=`#${p.number} (${p.team===0?'Orange':'Blau'}) schießt! t=${time.toFixed(1)} s`;
        logEvent(`${p.team===0?'ORANGE':'BLAU'} #${p.number}: Schussversuch`);
      }
    }
    const v=ball.linvel(),speed=Math.hypot(v.x,v.y,v.z);
    if(speed>.05) {
      const drag=.5*1.225*.25*Math.PI*ballRadius*ballRadius*speed;
      ball.addForce({x:-drag*v.x,y:-drag*v.y,z:-drag*v.z},true);
    }
    world.step();
    time+=dt;
    const ballNow=ball.translation();
    if(Math.abs(ballNow.x)>=21 && Math.abs(ballNow.z)<2.5 && ballNow.y<2) {
      if(ballNow.x>0)orange++;else blue++;
      lastContactText=`TOR! Orange ${orange} : ${blue} Blau — Anstoß folgt.`;
      logEvent(`TOR! ${ballNow.x>0?'ORANGE':'BLAU'} · ${orange}:${blue}`);
      goalFlash.classList.add('active');goalFlash.textContent=ballNow.x>0?'ORANGE CITY SCORES!':'BLUE UNITED SCORES!';playGoalHorn();
      kickoff();
    } else if(Math.abs(ballNow.x)>23.5 || Math.abs(ballNow.z)>16.5) {
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
    if(!paused) {
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
    if(crowdGain&&soundEnabled)crowdGain.gain.value=.08+Math.min(.16,Math.abs(bp.x)/21*.16);
    speedLabel.textContent=`BALL ${velocity.length().toFixed(1)} M/S`;
    contactLabel.textContent=`SHOTS ${contacts}`;
    scoreLabel.textContent=`${orange} : ${blue}`;
    status.textContent=lastContactText;
    if(cameraMode===0){camera.position.lerp(new THREE.Vector3(bp.x*.3,32,37),.025);camera.lookAt(bp.x*.3,0,0);}
    else if(cameraMode===1){camera.position.lerp(new THREE.Vector3(bp.x-12,12,bp.z+17),.04);camera.lookAt(bp.x,0,bp.z);}
    else{camera.position.lerp(new THREE.Vector3(0,58,.1),.035);camera.lookAt(0,0,0);}
    stadium.update(time,Math.min(1,Math.abs(bp.x)/21));
    renderer.render(scene,camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
start().catch(error=>{status.textContent=`Startfehler: ${String(error)}`;console.error(error);});
