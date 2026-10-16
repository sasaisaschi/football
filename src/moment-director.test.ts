import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { Match } from './match';
import { detectDecisiveMoment, MomentDirector } from './moment-director';
beforeAll(async()=>{await RAPIER.init();});
describe('decisive match moments',()=>{
  it('does not interrupt a restart or fabricate a moment on kickoff',()=>{
    const match=new Match(7);
    expect(detectDecisiveMoment(match)).toBeNull();
    expect(new MomentDirector(match).update()).toBeNull();
  });
  it('surfaces an actionable chance only from the actual live match state',()=>{
    const match=new Match(5);
    match.referee.state={phase:'play'};
    const striker=match.players.find(p=>p.team===0&&p.role==='ST')!;
    striker.motor.body.setTranslation({x:41,y:1,z:0},true);
    for(const p of match.players.filter(p=>p.team===1))p.motor.body.setTranslation({x:-25,y:1,z:p.id%2?15:-15},true);
    match.ball.setTranslation({x:41,y:0.2,z:0},true);
    const moment=detectDecisiveMoment(match);
    expect(moment).not.toBeNull();
    expect(moment?.playerId).toBe(striker.id);
    expect(moment?.options.some(o=>o.intent.kind==='shot')).toBe(true);
    expect(moment?.options.some(o=>o.intent.kind==='pass')).toBe(true);
    const director=new MomentDirector(match);
    expect(director.update()?.id).toBe(moment?.id);
    expect(director.choose(99)).toBe(false);
    expect(director.choose(0)).toBe(true);
    expect(striker.userIntent?.source).toBe('user');
    expect(striker.userIntent?.kind).toBe('shot');
    expect(match.score).toEqual([0,0]);
  });
  it('respects cooldown and does not show repeated uninterrupted decisions',()=>{
    const match=new Match(8);
    match.referee.state={phase:'play'};
    const striker=match.players.find(p=>p.team===0&&p.role==='ST')!;
    striker.motor.body.setTranslation({x:43,y:1,z:0},true);
    for(const p of match.players.filter(p=>p.team===1))p.motor.body.setTranslation({x:-25,y:1,z:15},true);
    match.ball.setTranslation({x:43,y:0.2,z:0},true);
    const director=new MomentDirector(match);
    expect(director.update()).not.toBeNull();
    director.dismiss();
    expect(director.update()).toBeNull();
  });
});
