import * as THREE from 'three';
import type { MatchSnapshot, PlayerProfile, TeamId } from '../engine/types';
import { tr } from '../i18n';
import { attackSign, PITCH } from '../physics/pitch-geometry';

/**
 * Law 11 made visible in a scene: a line across the pitch where an attacker of the team in possession would be
 * offside – level with the second-last opponent, or with the ball if it is further forward, never in the attackers'
 * own half. Computed every frame from the shown state (the same rule the referee and the players use), shown only
 * while that team is in the opponents' half.
 */
export function offsideX(s: MatchSnapshot, profiles: readonly PlayerProfile[], attackers: TeamId): number | null {
  const sign = attackSign(attackers, s.half);
  const depth = s.players.filter(p => !p.sentOff && profiles[p.id].team !== attackers).map(p => sign * p.position.x).sort((a, b) => b - a);
  if (depth.length < 2) return null;
  const line = Math.max(depth[1], sign * s.ball.position.x, 0);
  return sign * line;
}

export class OffsideLine {
  readonly group = new THREE.Group();
  private readonly strip: THREE.Mesh;
  private readonly label: THREE.Sprite;
  private shownX = NaN;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, depthWrite: false });
    this.strip = new THREE.Mesh(new THREE.PlaneGeometry(0.28, PITCH.width), mat);
    this.strip.rotation.x = -Math.PI / 2;
    this.strip.position.y = 0.035;
    this.strip.renderOrder = 2;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const c = canvas.getContext('2d')!;
    c.fillStyle = 'rgba(6,11,22,0.75)'; c.fillRect(0, 8, 256, 48);
    c.fillStyle = '#ffd23f'; c.font = '700 26px Bahnschrift, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(tr('OFFSIDE LINE', 'ABSEITSLINIE'), 128, 33);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.label.scale.set(4, 1, 1);
    this.label.renderOrder = 6;
    this.group.add(this.strip, this.label);
    this.group.visible = false;
  }

  /** `attackers`: the team in possession, or null to hide; the line glides to its new place instead of jumping. */
  update(s: MatchSnapshot, profiles: readonly PlayerProfile[], attackers: TeamId | null, camera: THREE.Camera): void {
    const x = attackers === null ? null : offsideX(s, profiles, attackers);
    if (x === null || x === 0) { this.group.visible = false; this.shownX = NaN; return; }
    this.shownX = Number.isNaN(this.shownX) ? x : this.shownX + (x - this.shownX) * 0.25;
    this.group.visible = true;
    this.strip.position.x = this.shownX;
    // The label sits on the line at the side of the pitch nearer the camera's view, slightly above the turf.
    const z = Math.max(-PITCH.halfWidth + 3, Math.min(PITCH.halfWidth - 3, camera.position.z * 0.25));
    this.label.position.set(this.shownX, 1.1, z);
  }
}
