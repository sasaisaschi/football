import { attackDirection, PITCH } from './pitch';
import type { Match } from './match';
import type { ActionIntent } from './kick-decision';

export type MomentOption = { label: string; description: string; intent: Omit<ActionIntent, 'source'> };
export type DecisiveMoment = { id: string; playerId: number; team: 0 | 1; heading: string; context: string; score: number; options: MomentOption[]; createdAt: number };
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const ground = (p: {x:number;z:number}) => ({x:p.x,z:p.z});
const aim = (x: number, z: number, targetX: number, targetZ: number) => {
  const d = Math.hypot(targetX-x,targetZ-z) || 1;
  return {dirX:(targetX-x)/d,dirZ:(targetZ-z)/d};
};

/** Select consequential opportunities from the current 22-player state, never fabricate an outcome. */
export function detectDecisiveMoment(match: Match, team: 0 | 1 = 0): DecisiveMoment | null {
  if (match.referee.state.phase !== 'play') return null;
  const b = match.ball.translation(), v = match.ball.linvel();
  if (Math.abs(b.x) > PITCH.halfLength || Math.abs(b.z) > PITCH.halfWidth) return null;
  const ours = match.players.filter(p=>p.team===team);
  const others = match.players.filter(p=>p.team!==team);
  const near = (players: typeof ours) => [...players].sort((a,c)=>{
    const pa=a.motor.body.translation(),pc=c.motor.body.translation();
    return Math.hypot(pa.x-b.x,pa.z-b.z)-Math.hypot(pc.x-b.x,pc.z-b.z);
  });
  const us=near(ours)[0], opponent=near(others)[0];
  const usP=ground(us.motor.body.translation()), themP=ground(opponent.motor.body.translation());
  const dUs=Math.hypot(usP.x-b.x,usP.z-b.z);
  const dThem=Math.hypot(themP.x-b.x,themP.z-b.z);
  const dir=attackDirection(team);
  const attack=dir*b.x, speed=Math.hypot(v.x,v.z);
  const teammate=ours.filter(p=>p.id!==us.id && p.role!=='GK')
    .sort((a,c)=>Math.hypot(a.motor.body.translation().x-b.x,a.motor.body.translation().z-b.z)-Math.hypot(c.motor.body.translation().x-b.x,c.motor.body.translation().z-b.z))[0];
  const passP=teammate.motor.body.translation();
  const passAim=aim(b.x,b.z,passP.x,passP.z);
  const goalAim=aim(b.x,b.z,dir*PITCH.halfLength,Math.max(-PITCH.goalHalfWidth+0.8,Math.min(PITCH.goalHalfWidth-0.8,-b.z*0.25)));
  const shotDistance=Math.hypot(dir*PITCH.halfLength-b.x,b.z);
  const ourPossession=dUs<dThem+0.5 && dUs<4.2;
  const theirThreat=!ourPossession && dThem<3.2 && dir*b.x< -PITCH.halfLength+32;
  const shotThreat=ourPossession && shotDistance<27 && dUs<2.8;
  const pressured=ourPossession && dThem<3.8 && attack>0;
  if (!shotThreat && !theirThreat && !pressured) return null;
  const score=shotThreat ? clamp(0.64+(27-shotDistance)/100+(3.8-dThem)*0.04) :
    theirThreat ? clamp(0.72+(32-(dir*b.x+PITCH.halfLength))*0.006) :
    clamp(0.58+(3.8-dThem)*0.035);
  if (score<0.62) return null;
  const options: MomentOption[]= theirThreat ? [
    {label:'ZUSTELLEN',description:'Den Laufweg schließen und den Angreifer unter Druck setzen.',intent:{kind:'control',dirX:Math.sign(b.x-usP.x)||dir,dirZ:0,elevation:0,ballSpeed:0}},
    {label:'KLÄREN',description:'Bei erreichbarem Ball den Befreiungsschlag versuchen.',intent:{kind:'clear',...aim(b.x,b.z,b.x-dir*32,b.z*0.7),elevation:0.22,ballSpeed:24}},
  ] : [
    {label:'ABSCHLUSS',description:'Auf das Tor schießen; Treffer hängt vom Fußkontakt ab.',intent:{kind:'shot',...goalAim,elevation:0.08,ballSpeed:26}},
    {label:'ABGEBEN',description:'Den freien Mitspieler anspielen.',intent:{kind:'pass',...passAim,elevation:0,ballSpeed:Math.max(9,Math.min(21,5+Math.hypot(passP.x-b.x,passP.z-b.z)*0.45)),targetPlayer:teammate.id}},
    {label:'DRIBBELN',description:'Den Ball nach vorne mitnehmen.',intent:{kind:'dribble',...aim(b.x,b.z,b.x+dir*12,b.z*0.65),elevation:0,ballSpeed:5.5}},
  ];
  return {id:`moment-${match.tick}-${us.id}`,playerId:us.id,team,heading:theirThreat?'GEFAHR IM STRAFRAUM':shotThreat?'ENTSCHEIDENDE TORCHANCE':'ENTSCHEIDUNG UNTER DRUCK',context:theirThreat?'Der Gegner ist gefährlich nah am Tor.':shotThreat?'Eine aussichtsreiche Abschlussposition.':'Ballbesitz unter unmittelbarem Gegnerdruck.',score,options,createdAt:match.time};
}

/** Throttle opportunities and ensure each choice belongs to the offered moment. */
export class MomentDirector {
  active: DecisiveMoment | null = null;
  private lastAt = -Infinity;
  constructor(private readonly match: Match, private readonly team: 0 | 1 = 0, private readonly cooldownSeconds = 22) {}
  update(): DecisiveMoment | null {
    if (this.active || this.match.time-this.lastAt<this.cooldownSeconds) return null;
    const found=detectDecisiveMoment(this.match,this.team);
    if (found) { this.active=found; this.lastAt=this.match.time; }
    return found;
  }
  choose(optionIndex: number): boolean {
    if (!this.active) return false;
    const moment=this.active, option=moment.options[optionIndex];
    if (!option || this.match.referee.state.phase!=='play') return false;
    this.match.setUserIntent(moment.playerId,option.intent);
    this.active=null;
    return true;
  }
  dismiss(): void { this.active=null; }
  reset(): void { this.active=null; this.lastAt=-Infinity; }
}
