import * as THREE from 'three';

/**
 * Matchday stadium presentation. No gameplay or ball authority lives here.
 * Crowd and architectural geometry are batched; lighting is limited to four fixtures.
 */
export function createStadium(scene: THREE.Scene) {
  scene.fog = new THREE.FogExp2(0x091424, .0032);
  const concrete = new THREE.MeshStandardMaterial({color:0x263448,roughness:.95});
  const steel = new THREE.MeshStandardMaterial({color:0x0b192c,metalness:.65,roughness:.4});
  const orange = new THREE.MeshBasicMaterial({color:0xff8c32});
  const cyan = new THREE.MeshBasicMaterial({color:0x57c9ff});
  const pale = new THREE.MeshBasicMaterial({color:0xd9ebf5});
  const dark = new THREE.MeshBasicMaterial({color:0x07111d});
  function box(x:number,y:number,z:number,w:number,h:number,d:number,mat:THREE.Material) {
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(x,y,z);scene.add(m);return m;
  }
  function banner(text:string,foreground:string,background:string,width=1024,height=128) {
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const c=canvas.getContext('2d')!;
    c.fillStyle=background;c.fillRect(0,0,width,height);
    c.fillStyle=foreground;c.font='900 70px Arial';c.textAlign='center';c.textBaseline='middle';
    c.fillText(text,width/2,height/2);
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;
    return new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide});
  }
  // The bowl is built from continuous dark terraces rather than isolated bead rows.
  for(let row=0;row<27;row++) {
    const offset=row*.66, y=.45+row*.43;
    const terrace=row%5===0?concrete:steel;
    for(const side of [-1,1]) {
      box(0,y-.25,side*(18.3+offset),59+offset*.5,.4,.74,terrace);
      box(side*(25+offset),y-.25,0,.74,.4,40+offset*.5,terrace);
    }
  }
  // One batched instanced mesh, but recognizable shoulder/head silhouettes.
  const rows=26,columns=125,total=rows*columns*4;
  const crowd=new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(.19,.22,3,5),
    new THREE.MeshStandardMaterial({color:0xffffff,roughness:.92}),
    total
  );
  const palette=['#e8edf1','#ef883c','#1686b5','#223b58','#f5c45b','#b8c4d0','#b85c39'].map(c=>new THREE.Color(c));
  const dummy=new THREE.Object3D();
  let n=0;
  for(let side=0;side<4;side++)for(let row=0;row<rows;row++)for(let j=0;j<columns;j++) {
    const along=(j/(columns-1)-.5)*(side<2?57:46);
    const depth=row*.66;
    const stagger=row%2*.24;
    const x=side<2?along+stagger:(side===2?-25-depth:25+depth);
    const z=side<2?(side===0?-18.3-depth:18.3+depth):along+stagger;
    dummy.position.set(x,1.02+row*.43,z);
    dummy.rotation.set(0,side<2?0:Math.PI/2,0);
    dummy.scale.set(.88,.86+(j*13+row*7)%7*.028,.86);
    dummy.updateMatrix();crowd.setMatrixAt(n,dummy.matrix);
    const section=(Math.floor(j/19)+Math.floor(row/7))%4;
    const colorIndex=(j*17+row*11)%11===0?4:section===0?1:section===1?2:section===2?0:3;
    crowd.setColorAt(n,palette[colorIndex]);
    n++;
  }
  crowd.instanceMatrix.needsUpdate=true;
  if(crowd.instanceColor)crowd.instanceColor.needsUpdate=true;
  crowd.castShadow=false;crowd.receiveShadow=false;scene.add(crowd);

  // Upper tier, glazed executive boxes and roof fascia.
  for(const sign of [-1,1]) {
    box(0,13.1,sign*37,90,2.6,2.3,concrete);
    box(sign*44,13.1,0,2.3,2.6,76,concrete);
    for(let i=-9;i<=9;i++)box(i*4.25,14.7,sign*37.2,3.75,2.5,.12,
      new THREE.MeshBasicMaterial({color:(i%3===0)?0x1a5069:0x112c45}));
    for(let i=-8;i<=8;i++)box(sign*44.2,14.7,i*4.2,.12,2.5,3.65,
      new THREE.MeshBasicMaterial({color:i%3===0?0x1a5069:0x112c45}));
  }
  for(const sign of [-1,1]) {
    box(0,19.1,sign*37,96,1.5,12,steel);
    box(sign*44,19.1,0,12,1.5,80,steel);
    box(0,17.95,sign*31.5,91,.14,.3,orange);
    box(sign*38.5,17.95,0,.3,.14,75,cyan);
  }
  // High contrast pitch-level ribbon: actual graphic typography, not blinking blocks.
  const ribbonA=banner('THE 12TH MAN  •  THIS IS OUR HOME', '#ffffff','#e56a20');
  const ribbonB=banner('MATCHDAY  •  FEEL EVERY MOMENT', '#eafaff','#075479');
  const ribbons:THREE.Mesh[]=[];
  for(const z of [-16.3,16.3]) {
    const m=box(0,.74,z,46,1.15,.08,z>0?ribbonA:ribbonB);
    ribbons.push(m);
  }
  for(const x of [-23.3,23.3]) {
    const m=box(x,.74,0,.08,1.15,29,x>0?ribbonB:ribbonA);
    ribbons.push(m);
  }
  // An authentic stadium-scale main screen, scoreboard and supporter banners.
  const screen=banner('ORANGE CITY  VS  BLUE UNITED','#ffffff','#07162a');
  const screenMesh=new THREE.Mesh(new THREE.PlaneGeometry(25,3.5),screen);
  screenMesh.position.set(0,15.6,-37.7);scene.add(screenMesh);
  box(0,15.6,-37.8,26,4,.4,steel);
  screenMesh.position.z=-37.5;
  const tifo=banner('WE ARE THE TWELFTH MAN','#ffb15b','#102c49');
  const tifoMesh=new THREE.Mesh(new THREE.PlaneGeometry(26,2.3),tifo);
  tifoMesh.position.set(0,9.5,-35.8);scene.add(tifoMesh);
  // Real goal net geometry, visible from the main TV angle.
  const netMat=new THREE.LineBasicMaterial({color:0xeaf4ff,transparent:true,opacity:.4});
  for(const sx of [-1,1]) {
    const x=sx*21;
    const segments:THREE.Vector3[]=[];
    for(let j=0;j<=10;j++){
      const z=-2.5+j*.5;
      segments.push(new THREE.Vector3(x,.12,z),new THREE.Vector3(x+sx*1.3,.12,z));
      segments.push(new THREE.Vector3(x+sx*1.3,.12,z),new THREE.Vector3(x+sx*1.3,2,z));
    }
    for(let j=0;j<=8;j++){
      const y=j*.25;
      segments.push(new THREE.Vector3(x+sx*1.3,y,-2.5),new THREE.Vector3(x+sx*1.3,y,2.5));
    }
    const g=new THREE.BufferGeometry().setFromPoints(segments);
    scene.add(new THREE.LineSegments(g,netMat));
  }
  // Four light arrays; emissive panel surfaces create the visible floodlight glow.
  const glowMat=new THREE.MeshBasicMaterial({color:0xf0f7ff});
  for(const x of [-32,32])for(const z of [-29,29]) {
    box(x,19.6,z,.7,9,.7,steel);
    box(x,24,z,9,2.3,.45,glowMat);
    const light=new THREE.PointLight(0xe1eeff,85,70,2);
    light.position.set(x,22.5,z);scene.add(light);
  }
  const boardMaterials=[ribbonA,ribbonB];
  return {
    update(time:number,intensity:number) {
      // Low-cost crowd movement: entire instanced draw call subtly responds.
      crowd.position.y=Math.sin(time*1.8)*.015*(1+intensity*2);
      const active=Math.floor(time/13)%2;
      for(let i=0;i<ribbons.length;i++)ribbons[i].material=boardMaterials[(i+active)%2];
    }
  };
}
