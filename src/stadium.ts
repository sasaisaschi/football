import * as THREE from 'three';
/** Presentation-only stadium. The match remains authoritative in Rapier. */
export function createStadium(scene:THREE.Scene){
  scene.fog=new THREE.FogExp2(0x0c1324,.006);
  const concrete=new THREE.MeshStandardMaterial({color:0x283447,roughness:.92});
  const colors=[new THREE.Color('#ff8a36'),new THREE.Color('#2486c7'),new THREE.Color('#f6f2e7'),new THREE.Color('#1a3858')];
  function block(x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);scene.add(mesh);return mesh;
  }
  const count=7200;
  const crowd=new THREE.InstancedMesh(new THREE.SphereGeometry(.18,5,4),new THREE.MeshStandardMaterial({color:0xffffff}),count);
  const dummy=new THREE.Object3D();
  let index=0;
  for(let side=0;side<4;side++)for(let row=0;row<18;row++)for(let j=0;j<100;j++){
    const along=(j/99-.5)*(side<2?55:44);
    const depth=row*.75;
    dummy.position.set(side<2?along:(side===2?-26-depth:26+depth),1.3+row*.39,side<2?(side===0?-19-depth:19+depth):along);
    dummy.scale.setScalar(.9);dummy.updateMatrix();
    crowd.setMatrixAt(index,dummy.matrix);crowd.setColorAt(index,colors[(j*7+row*13+side)%4]);index++;
  }
  crowd.instanceMatrix.needsUpdate=true;if(crowd.instanceColor)crowd.instanceColor.needsUpdate=true;scene.add(crowd);
  for(let row=0;row<18;row++){
    const h=.4+row*.39,offset=row*.75;
    for(const sign of [-1,1]){
      block(0,h-.1,sign*(19+offset),57,.3,.7,concrete);
      block(sign*(26+offset),h-.1,0,.7,.3,46,concrete);
    }
  }
  const boardMaterials=[0xff8b35,0x4bc4ff,0xffffff].map(color=>new THREE.MeshBasicMaterial({color}));
  const boards:THREE.Mesh[]=[];
  for(let i=0;i<18;i++)for(const z of [-15.5,15.5])boards.push(block(-21+i*2.47,.55,z,2.3,.95,.14,boardMaterials[i%3]));
  for(let i=0;i<12;i++)for(const x of [-23,23])boards.push(block(x,.55,-14+i*2.55,.14,.95,2.4,boardMaterials[i%3]));
  for(const x of [-27,27])for(const z of [-21,21]){
    block(x,11,z,.65,22,.65,concrete);
    block(x,22,z,5,2.5,.8,new THREE.MeshBasicMaterial({color:0xe5f2ff}));
    const light=new THREE.PointLight(0xc5ddff,130,70,2);light.position.set(x,21,z);scene.add(light);
  }
  const roof=new THREE.MeshStandardMaterial({color:0x101c31,metalness:.45,roughness:.65});
  for(const z of [-32,32])block(0,14,z,80,.6,8,roof);
  for(const x of [-39,39])block(x,14,0,8,.6,64,roof);
  for(const x of [-36,36])block(x,12,0,.5,4,13,new THREE.MeshBasicMaterial({color:0x12395d}));
  return {update(time:number,intensity:number){
    for(let i=0;i<boards.length;i++)(boards[i].material as THREE.MeshBasicMaterial).color.setHex([0xff8b35,0x4bc4ff,0xffffff][(Math.floor(time*.6)+Math.floor(i/4))%3]);
    crowd.rotation.y=Math.sin(time*.45)*.0006*(1+intensity);
  }};
}
