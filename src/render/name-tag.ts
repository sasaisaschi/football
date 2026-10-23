import * as THREE from 'three';
import type { MatchSnapshot, PlayerProfile } from '../engine/types';
import { SPRINT_SPEED } from '../intel/stats';

/** Height of the tag above the turf (m) and its size on screen (world units at LABEL distance, shrinking closer). */
const TAG_HEIGHT = 2.9, TAG_WIDTH = 5.2, TAG_NEAR = 30;

/**
 * Player identification in the picture: a name tag over the viewer's focus player, with his running speed added while
 * he sprints (above SPRINT_SPEED). The speed is his body's speed in the displayed frame – nothing estimated.
 */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private text = '';

  constructor(private readonly profile: PlayerProfile, colour: string) {
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true }));
    this.sprite.renderOrder = 6;
    this.sprite.userData.colour = colour;
  }

  private draw(text: string, sprinting: boolean): void {
    if (text === this.text) return;
    this.text = text;
    const x = this.canvas.getContext('2d')!;
    x.clearRect(0, 0, 512, 128);
    x.fillStyle = 'rgba(6, 11, 22, 0.82)';
    x.beginPath(); x.roundRect(8, 24, 496, 80, 18); x.fill();
    x.fillStyle = sprinting ? '#ffd23f' : String(this.sprite.userData.colour);
    x.fillRect(8, 24, 10, 80);
    x.fillStyle = '#f3f6fb';
    x.font = '800 54px Bahnschrift, Segoe UI, sans-serif';
    x.textBaseline = 'middle';
    x.fillText(text, 34, 66, 456);
    this.texture.needsUpdate = true;
  }

  update(frame: MatchSnapshot, camera: THREE.Camera): void {
    const p = frame.players[this.profile.id];
    this.sprite.visible = !p.sentOff;
    if (p.sentOff) return;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const sprinting = speed > SPRINT_SPEED;
    this.draw(`${this.profile.number} ${this.profile.name}${sprinting ? ` · ${Math.round(speed * 3.6)} km/h` : ''}`, sprinting);
    this.sprite.position.set(p.position.x, TAG_HEIGHT, p.position.z);
    const k = Math.min(1, this.sprite.position.distanceTo(camera.position) / TAG_NEAR);
    this.sprite.scale.set(TAG_WIDTH * k, (TAG_WIDTH / 4) * k, 1);
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}
