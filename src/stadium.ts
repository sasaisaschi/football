import * as THREE from 'three';
import { PITCH } from './pitch';

/**
 * Matchday stadium presentation around the 105 × 68 m pitch. No gameplay or ball authority lives here.
 * Crowd and architectural geometry are batched; lighting is limited to four floodlight towers.
 */
export function createStadium(scene: THREE.Scene) {
  scene.fog = new THREE.FogExp2(0x091424, .0016);
  // Inner edge of the lower tier: behind the run-off on all four sides.
  const SX = PITCH.halfLength + PITCH.runOff + 1;
  const SZ = PITCH.halfWidth + PITCH.runOff + 1;
  const rows = 26, rowDepth = .66, rowRise = .43, tierDepth = rows * rowDepth;
  const concrete = new THREE.MeshStandardMaterial({color:0x263448,roughness:.95});
  const steel = new THREE.MeshStandardMaterial({color:0x0b192c,metalness:.65,roughness:.4});
  const orange = new THREE.MeshBasicMaterial({color:0xff8c32});
  const cyan = new THREE.MeshBasicMaterial({color:0x57c9ff});
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
  for(let row=0;row<=rows;row++) {
    const offset=row*rowDepth, y=.45+row*rowRise;
    const terrace=row%5===0?concrete:steel;
    for(const side of [-1,1]) {
      box(0,y-.25,side*(SZ+offset),2*(SX+offset),.4,.74,terrace);
      box(side*(SX+offset),y-.25,0,.74,.4,2*(SZ+offset),terrace);
    }
  }
  // One batched instanced mesh, but recognizable shoulder/head silhouettes.
  const seat=.46;
  const longColumns=Math.round(2*SX/seat), endColumns=Math.round(2*SZ/seat);
  const total=rows*(longColumns+endColumns)*2;
  const crowd=new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(.19,.22,3,5),
    new THREE.MeshStandardMaterial({color:0xffffff,roughness:.92}),
    total
  );
  const palette=['#e8edf1','#ef883c','#1686b5','#223b58','#f5c45b','#b8c4d0','#b85c39'].map(c=>new THREE.Color(c));
  const dummy=new THREE.Object3D();
  let n=0;
  for(let side=0;side<4;side++) {
    const long=side<2, columns=long?longColumns:endColumns;
    for(let row=0;row<rows;row++)for(let j=0;j<columns;j++) {
      const depth=row*rowDepth;
      const along=(j/(columns-1)-.5)*(long?2*(SX+depth)-2:2*(SZ+depth)-2)+row%2*.24;
      const x=long?along:(side===2?-SX-depth:SX+depth);
      const z=long?(side===0?-SZ-depth:SZ+depth):along;
      dummy.position.set(x,1.02+row*rowRise,z);
      dummy.rotation.set(0,long?0:Math.PI/2,0);
      dummy.scale.set(.88,.86+(j*13+row*7)%7*.028,.86);
      dummy.updateMatrix();crowd.setMatrixAt(n,dummy.matrix);
      const section=(Math.floor(j/19)+Math.floor(row/7))%4;
      const colorIndex=(j*17+row*11)%11===0?4:section===0?1:section===1?2:section===2?0:3;
      crowd.setColorAt(n,palette[colorIndex]);
      n++;
    }
  }
  crowd.instanceMatrix.needsUpdate=true;
  if(crowd.instanceColor)crowd.instanceColor.needsUpdate=true;
  crowd.castShadow=false;crowd.receiveShadow=false;scene.add(crowd);

  // Image-based stand panels behind the lower tier. The asset can be replaced without touching gameplay.
  const standTexture=new THREE.TextureLoader().load('/assets/stadium/crowd-stand.svg');
  standTexture.colorSpace=THREE.SRGBColorSpace;
  const standMaterial=new THREE.MeshBasicMaterial({map:standTexture,side:THREE.DoubleSide});
  const back=tierDepth+1;
  for(const s of [-1,1]) {
    const longPanel=new THREE.Mesh(new THREE.PlaneGeometry(2*(SX+back),10.8),standMaterial);
    longPanel.position.set(0,rows*rowRise-3.5,s*(SZ+back));
    longPanel.rotation.y=s>0?Math.PI:0;
    scene.add(longPanel);
    const endPanel=new THREE.Mesh(new THREE.PlaneGeometry(2*(SZ+back),10.8),standMaterial);
    endPanel.position.set(s*(SX+back),rows*rowRise-3.5,0);
    endPanel.rotation.y=s>0?-Math.PI/2:Math.PI/2;
    scene.add(endPanel);
  }
  // Upper tier, glazed executive boxes and roof fascia.
  const upperZ=SZ+tierDepth+1.5, upperX=SX+tierDepth+1.5;
  const glassA=new THREE.MeshBasicMaterial({color:0x1a5069}), glassB=new THREE.MeshBasicMaterial({color:0x112c45});
  for(const sign of [-1,1]) {
    box(0,13.1,sign*upperZ,2*upperX,2.6,2.3,concrete);
    box(sign*upperX,13.1,0,2.3,2.6,2*upperZ,concrete);
    const longBoxes=Math.floor(upperX/4.25), endBoxes=Math.floor(upperZ/4.2);
    for(let i=-longBoxes;i<=longBoxes;i++)box(i*4.25,14.7,sign*(upperZ+.2),3.75,2.5,.12,i%3===0?glassA:glassB);
    for(let i=-endBoxes;i<=endBoxes;i++)box(sign*(upperX+.2),14.7,i*4.2,.12,2.5,3.65,i%3===0?glassA:glassB);
    box(0,19.1,sign*upperZ,2*upperX+6,1.5,12,steel);
    box(sign*upperX,19.1,0,12,1.5,2*upperZ+4,steel);
    box(0,17.95,sign*(upperZ-5.5),2*upperX,.14,.3,orange);
    box(sign*(upperX-5.5),17.95,0,.3,.14,2*upperZ-10,cyan);
  }
  // Pitch-side advertising boards just outside the field of play.
  const ribbonA=banner('THE 12TH MAN  •  THIS IS OUR HOME', '#ffffff','#e56a20');
  const ribbonB=banner('MATCHDAY  •  FEEL EVERY MOMENT', '#eafaff','#075479');
  const ribbons:THREE.Mesh[]=[];
  const boardZ=PITCH.halfWidth+4, boardX=PITCH.halfLength+PITCH.goalDepth+2.5;
  for(const z of [-boardZ,boardZ])for(const x of [-PITCH.halfLength/2,PITCH.halfLength/2]) {
    ribbons.push(box(x,.5,z,PITCH.halfLength-2,1,.08,z>0?ribbonA:ribbonB));
  }
  for(const x of [-boardX,boardX])for(const z of [-PITCH.halfWidth/2,PITCH.halfWidth/2]) {
    ribbons.push(box(x,.5,z,.08,1,PITCH.halfWidth-2,x>0?ribbonB:ribbonA));
  }
  // Main screen and supporter banner above the far stand.
  const screen=banner('ORANGE CITY  VS  BLUE UNITED','#ffffff','#07162a');
  const screenMesh=new THREE.Mesh(new THREE.PlaneGeometry(25,3.5),screen);
  box(0,15.6,-upperZ-.3,26,4,.4,steel);
  screenMesh.position.set(0,15.6,-upperZ);scene.add(screenMesh);
  const tifo=banner('WE ARE THE TWELFTH MAN','#ffb15b','#102c49');
  const tifoMesh=new THREE.Mesh(new THREE.PlaneGeometry(40,3.5),tifo);
  tifoMesh.position.set(0,9.5,-(SZ+tierDepth-.5));scene.add(tifoMesh);
  // Four floodlight towers; emissive panels create the visible glow.
  const glowMat=new THREE.MeshBasicMaterial({color:0xf0f7ff});
  for(const x of [-(SX+6),SX+6])for(const z of [-(SZ+6),SZ+6]) {
    box(x,17,z,.9,34,.9,steel);
    box(x,35,z,10,3,.5,glowMat);
    const light=new THREE.PointLight(0xe1eeff,1400,170,2);
    light.position.set(x,33,z);scene.add(light);
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
