// ============================================================================
// lod.ts — performance: only draw what the camera can see.
//
// Every creature and every station registers here with a rough size. Each
// frame we test it against the camera's view (its "frustum"):
//
//   off-screen       -> hidden (not drawn, no shadow, no leg animation)
//                       ...but it still EXISTS: workers keep carrying,
//                       customers keep buying, piles keep regrowing.
//   on-screen, near  -> full detail: animated legs + shadows
//   on-screen, far   -> LOD: no shadow, legs animate at a lower rate
//
// Why it matters: skinned (rigged) models can't use three.js's automatic
// culling reliably, so without this every bug in all three zones was being
// drawn twice per frame (once for the screen, once for the shadow map).
// ============================================================================
import * as THREE from 'three';

interface Entry {
  obj: THREE.Object3D;
  radius: number;          // rough size of the thing, in world units
  meshes: THREE.Mesh[];    // its meshes (to switch shadows on/off), filled lazily
  shadows: boolean;        // does it normally cast a shadow?
  shadowOn: boolean;
  scene: THREE.Object3D | null;
  attached: boolean;       // has it ever been in a scene? (so we know when it's gone)
  far: boolean;
}

/** Distance (from the camera's focus point) past which bugs lose shadows. */
const SHADOW_RANGE = 20;

class Lod {
  private entries: Entry[] = [];
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private tmp = new THREE.Vector3();
  /** Stats for the debug overlay / testing. */
  stats = { total: 0, visible: 0 };

  /** Track an object. `radius` = roughly how big it is. */
  add(obj: THREE.Object3D, radius: number, shadows = true) {
    this.entries.push({ obj, radius, meshes: [], shadows, shadowOn: shadows, scene: null, attached: false, far: false });
  }

  /** True if this object is far away (callers can update it less often). */
  isFar(obj: THREE.Object3D) {
    return obj.userData.lodFar === true;
  }

  private topOf(o: THREE.Object3D) {
    let cur = o;
    while (cur.parent) cur = cur.parent;
    return cur;
  }

  /**
   * Run once per frame for the scene being drawn.
   * @param focus the point the camera follows (the player)
   */
  update(scene: THREE.Scene, camera: THREE.Camera, focus: THREE.Vector3) {
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    let total = 0;
    let visible = 0;

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      const top = this.topOf(e.obj);
      if (!(top as THREE.Scene).isScene) {
        // Removed from the world (a customer who left) -> forget it.
        if (e.attached) this.entries.splice(i, 1);
        continue;
      }
      e.attached = true;
      if (top !== scene) continue; // belongs to the other mode's scene
      total++;

      e.obj.getWorldPosition(this.tmp);
      this.sphere.center.copy(this.tmp);
      this.sphere.center.y += e.radius * 0.4;
      this.sphere.radius = e.radius + 1; // a little margin so things don't pop at the edges
      // Something the game itself put away (e.g. the pilot is up in the helicopter):
      // stays hidden even when the camera could see that spot.
      if (e.obj.userData.hidden) {
        e.obj.visible = false;
        continue;
      }
      const inView = this.frustum.intersectsSphere(this.sphere);
      e.obj.visible = inView;
      if (!inView) continue;
      visible++;

      // Distance LOD: far things don't cast shadows (they'd fall outside the
      // shadow area anyway) and animate at a lower rate.
      const dist = Math.hypot(this.tmp.x - focus.x, this.tmp.z - focus.z);
      const far = dist > SHADOW_RANGE;
      e.far = far;
      e.obj.userData.lodFar = far;
      const wantShadow = e.shadows && !far;
      if (wantShadow !== e.shadowOn) {
        if (!e.meshes.length) e.obj.traverse((o) => (o as THREE.Mesh).isMesh && e.meshes.push(o as THREE.Mesh));
        for (const mesh of e.meshes) mesh.castShadow = wantShadow;
        e.shadowOn = wantShadow;
      }
    }
    this.stats.total = total;
    this.stats.visible = visible;
  }

  /** Make everything visible again (e.g. before switching scenes). */
  showAll() {
    for (const e of this.entries) e.obj.visible = true;
  }
}

/** The one shared culling/LOD manager. */
export const lod = new Lod();
