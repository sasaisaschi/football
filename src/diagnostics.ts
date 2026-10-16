import * as THREE from 'three';
import { BALL } from './ball';
import { LEG } from './foot-contact';
import type { Match, MatchEvent } from './match';
import { BODY } from './player-motor';

type Marker = { mesh: THREE.Mesh; born: number };

/**
 * Optional contact diagnostics: real collider shapes, planned contact points and every physical ball touch.
 * It reads simulation state only; switching it on or off changes nothing in the match.
 */
export function createContactDiagnostics(scene: THREE.Scene, match: Match) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const wire = (color: number, opacity = .8) => new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity, depthTest: false });
  const restMat = wire(0x9fb4c8), swingMat = wire(0xffd23f), bodyMat = wire(0x57c9ff, .12);
  const footGeo = new THREE.CapsuleGeometry(LEG.footRadius, LEG.footHalfLength * 2, 3, 8);
  const bodyGeo = new THREE.CapsuleGeometry(BODY.radius, BODY.halfHeight * 2, 3, 10);
  const feet = match.players.flatMap(p => p.legs.feet.map(f => {
    const mesh = new THREE.Mesh(footGeo, restMat);
    mesh.renderOrder = 10; group.add(mesh);
    return { foot: f, legs: p.legs, mesh };
  }));
  const bodies = match.players.map(p => {
    const mesh = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(mesh);
    return { p, mesh };
  });
  const planMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8, depthTest: false });
  const planMarkers = match.players.map(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 8), planMat);
    m.renderOrder = 11; group.add(m); return m;
  });
  const touchGeo = new THREE.SphereGeometry(BALL.radius * 1.15, 14, 10);
  const footTouch = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthTest: false });
  const bodyTouch = new THREE.MeshBasicMaterial({ color: 0xff5a4f, transparent: true, depthTest: false });
  const markers: Marker[] = [];
  match.onEvent((e: MatchEvent) => {
    if (e.type !== 'touch' || !e.position) return;
    const mesh = new THREE.Mesh(touchGeo, (e.payload?.part === 'foot' ? footTouch : bodyTouch).clone());
    mesh.position.set(...e.position);
    mesh.renderOrder = 12;
    group.add(mesh);
    markers.push({ mesh, born: match.time });
    if (markers.length > 40) group.remove(markers.shift()!.mesh);
  });
  return {
    get visible() { return group.visible; },
    setVisible(v: boolean) { group.visible = v; },
    update() {
      if (!group.visible) return;
      for (const f of feet) {
        const t = f.foot.body.translation(), r = f.foot.body.rotation();
        f.mesh.position.set(t.x, t.y, t.z);
        f.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        f.mesh.material = f.legs.swing?.foot === f.foot ? swingMat : restMat;
      }
      for (const b of bodies) {
        const t = b.p.motor.body.translation();
        b.mesh.position.set(t.x, t.y, t.z);
      }
      match.players.forEach((p, i) => {
        const s = p.legs.swing;
        planMarkers[i].visible = !!s && (s.phase === 'windup' || s.phase === 'strike');
        if (s) {
          const t = p.motor.body.translation();
          planMarkers[i].position.set(t.x + s.plan.contact.x, s.plan.contact.y, t.z + s.plan.contact.z);
        }
      });
      for (const m of markers) {
        const age = match.time - m.born;
        (m.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, .85 - age * .3);
      }
    },
  };
}
