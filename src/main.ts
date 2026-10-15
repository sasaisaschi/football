import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App element missing');
app.innerHTML = `
  <header><div><h1>FOOTBALL / Autonomous Match 002</h1><p>3 gegen 3 · Live-Spiel · echte Ballphysik</p></div>
  <div class="actions"><button id="pause">Pause</button><button id="reset">Neustart</button></div></header>
  <main id="viewport"><div class="hud"><strong>LIVE SIMULATION</strong><div id="clock">Zeit: 0.0 s</div><div id="speed">Ball: 0.0 m/s</div><div id="score">ORANGE 0 : 0 BLAU</div><div id="contacts">Schüsse: 0</div><div id="frames">Physik: 60 Hz (Soll)</div></div>
  <div class="status" id="status">Initialisiere Rapier WebAssembly …</div></main>`;

const status = document.querySelector<HTMLElement>('#status')!;
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const clockLabel = document.querySelector<HTMLElement>('#clock')!;
const speedLabel = document.querySelector<HTMLElement>('#speed')!;
const contactLabel = document.querySelector<HTMLElement>('#contacts')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;

async function start(): Promise<void> {
  await RAPIER.init();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101a32');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(0, 42, 49);
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
  type Player = { body:RAPIER.RigidBody; mesh:THREE.Group; color:string; kicks:number; cooldown:number; initial:[number,number]; team:number; number:number };
  const players: Player[] = [];
  for(const [i,x,z,color] of [[0,-13,-7,'#ff913d'],[1,-10,0,'#ff913d'],[2,-13,7,'#ff913d'],[3,13,-7,'#52caff'],[4,10,0,'#52caff'],[5,13,7,'#52caff']] as const) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,.9,z).lockRotations().setLinearDamping(2));
    world.createCollider(RAPIER.ColliderDesc.capsule(.52,.32).setMass(75).setFriction(.9).setRestitution(0),body);
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({color,roughness:.75});
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(.32,.28,1.05,12),material);
    torso.position.y=1.05; torso.castShadow=true; group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.22,12,12),new THREE.MeshStandardMaterial({color:'#e7b88d'}));
    head.position.y=1.83;head.castShadow=true;group.add(head);
    scene.add(group);
    players.push({body,mesh:group,color,kicks:0,cooldown:0,initial:[x,z],team:i<3?0:1,number:i+1});
  }

  let paused=false, time=0, contacts=0, accumulator=0, previous=performance.now();
  let orange=0, blue=0;
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
    time=0;contacts=0;accumulator=0;orange=0;blue=0;kickoffDelay=0;
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
      const targetX=rank===0?b.x:Math.max(-19,Math.min(19,b.x-attack*(3+rank*2)));
      const targetZ=rank===0?b.z:Math.max(-12,Math.min(12,b.z+(p.initial[1]<0?-1:1)*(3+rank)));
      const tx=targetX-pos.x,tz=targetZ-pos.z, d=Math.hypot(tx,tz);
      const maxSpeed=6.2, maxAcceleration=8.5;
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
      kickoff();
    } else if(Math.abs(ballNow.x)>23.5 || Math.abs(ballNow.z)>16.5) {
      lastContactText='Ausball: neuer Anstoß (Einwurf-Regeln folgen).';
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
    });
    const v=ball.linvel();velocity.set(v.x,v.y,v.z);
    clockLabel.textContent=`Zeit: ${time.toFixed(1)} s`;
    speedLabel.textContent=`Ball: ${velocity.length().toFixed(1)} m/s`;
    contactLabel.textContent=`Schüsse: ${contacts}`;
    scoreLabel.textContent=`ORANGE ${orange} : ${blue} BLAU`;
    status.textContent=lastContactText+' | 3v3-Test: keine trainierte KI, keine vollständigen Fußballregeln.';
    renderer.render(scene,camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
start().catch(error=>{status.textContent=`Startfehler: ${String(error)}`;console.error(error);});
