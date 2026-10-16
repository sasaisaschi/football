import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type FootballerVisual={
  root:THREE.Group;
  mixer:THREE.AnimationMixer;
  actions:Map<string,THREE.AnimationAction>;
  current:string;
};
const loader=new GLTFLoader();
const modelCache=new Map<string,Promise<Awaited<ReturnType<typeof loader.loadAsync>>|null>>();
function fetchModel(url:string){
  if(!modelCache.has(url))modelCache.set(url,loader.loadAsync(url).catch((error:unknown)=>{
    console.warn(`Footballer model ${url} not available, placeholder figure stays in use:`,error);
    return null;
  }));
  return modelCache.get(url)!;
}
const animations=['idle','run','walk','kick','celebrate'] as const;
function clipFor(clips:THREE.AnimationClip[],name:string):THREE.AnimationClip|undefined{
  const keywords:Record<string,string[]>={idle:['idle','breath','stand'],run:['run','sprint','jog'],walk:['walk'],kick:['kick','shoot','strike'],celebrate:['celebrat','cheer','victory']};
  return clips.find(c=>keywords[name].some(k=>c.name.toLowerCase().includes(k)));
}
export async function loadFootballer(team:number,number:number):Promise<FootballerVisual|null>{
  // Project-owned, licensed GLB assets go in public/models/. No remote unlicensed asset URLs.
  const url=team===0?'/models/orange-footballer.glb':'/models/blue-footballer.glb';
  const gltf=await fetchModel(url);
  if(!gltf)return null;
  const root=new THREE.Group();
  const cloned=gltf.scene.clone(true);
  root.add(cloned);
  // Normalize size to an approximately 1.85m footballer without modifying physics.
  const bounds=new THREE.Box3().setFromObject(cloned);
  const size=bounds.getSize(new THREE.Vector3());
  if(size.y>.001){
    const scale=1.85/size.y;cloned.scale.multiplyScalar(scale);
    bounds.setFromObject(cloned);
    cloned.position.y-=bounds.min.y;
  }
  cloned.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  const mixer=new THREE.AnimationMixer(cloned);
  const actions=new Map<string,THREE.AnimationAction>();
  for(const name of animations){
    const clip=clipFor(gltf.animations,name);
    if(clip)actions.set(name,mixer.clipAction(clip));
  }
  const first=actions.has('idle')?'idle':actions.has('run')?'run':'';
  if(first)actions.get(first)!.play();
  root.userData.playerNumber=number;
  return {root,mixer,actions,current:first};
}
export function updateFootballer(visual:FootballerVisual,dt:number,speed:number,swinging:boolean):void{
  const target=speed>3.2?'run':speed>.5?'walk':'idle';
  const name=visual.actions.has(target)?target:visual.actions.has('run')?'run':'idle';
  if(name!==visual.current&&visual.actions.has(name)){
    const old=visual.actions.get(visual.current);
    const next=visual.actions.get(name)!;
    next.reset().fadeIn(.22).play();
    old?.fadeOut(.22);
    visual.current=name;
  }
  const action=visual.actions.get(name);
  if(action)action.timeScale=Math.max(.65,Math.min(1.6,speed/4.5));
  // The clip only accompanies a swing that the physics foot is really performing; it never causes contact.
  if(swinging&&visual.actions.has('kick')&&visual.current!=='kick'){
    visual.actions.get(visual.current)?.fadeOut(.08);
    visual.actions.get('kick')!.reset().fadeIn(.08).play();
    visual.current='kick';
  }
  visual.mixer.update(dt);
}
