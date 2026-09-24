// three.js 렌더링. 시뮬 스냅샷(renderState)만 받아서 그린다.

import * as THREE from 'three';
import { ANAT, CFG } from './config.js';
import { solveArm, v3 } from './math.js';

const Y = new THREE.Vector3(0, 1, 0);
const tv = (p) => new THREE.Vector3(p.x, p.y, p.z);

const PALETTE = [
  { skin: 0xc98f6d, trunks: 0xb8242c, gloves: 0xc41e2a, trim: 0xf2f2f2, hair: 0x1c1410 },
  { skin: 0x8a5a3c, trunks: 0x1d4ea8, gloves: 0x1b48b8, trim: 0xf2f2f2, hair: 0x0f0c0a },
];

function std(color, rough = 0.6, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function limb(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function placeLimb(mesh, a, b) {
  const A = tv(a), B = tv(b);
  const d = B.clone().sub(A);
  const l = d.length();
  mesh.position.copy(A).addScaledVector(d, 0.5);
  if (l > 1e-6) mesh.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / l));
  mesh.scale.set(1, Math.max(0.001, l), 1);
}

class FighterMesh {
  constructor(scene, idx) {
    const pal = PALETTE[idx];
    const skin = std(pal.skin, 0.55);
    const trunks = std(pal.trunks, 0.7);
    const gloves = std(pal.gloves, 0.45);
    const trim = std(pal.trim, 0.6);
    const hair = std(pal.hair, 0.9);
    this.group = new THREE.Group();
    scene.add(this.group);
    const g = this.group;
    const cyl = (rt, rb) => new THREE.CylinderGeometry(rt, rb, 1, 12, 1);
    const sph = (r) => new THREE.SphereGeometry(r, 20, 14);

    // 몸통
    this.torso = limb(new THREE.CapsuleGeometry(0.16, 0.26, 6, 14), skin);
    g.add(this.torso);
    this.chestMesh = limb(sph(0.2), skin);
    this.chestMesh.scale.set(1.18, 0.78, 0.72);
    g.add(this.chestMesh);
    this.trunks = limb(new THREE.CylinderGeometry(0.19, 0.2, 0.26, 16), trunks);
    g.add(this.trunks);
    this.waistband = limb(new THREE.CylinderGeometry(0.195, 0.195, 0.045, 16), trim);
    g.add(this.waistband);
    this.neck = limb(cyl(0.055, 0.065), skin);
    g.add(this.neck);

    // 머리
    this.head = new THREE.Group();
    const skull = limb(sph(ANAT.headR), skin);
    skull.scale.set(0.9, 1.06, 1.0);
    this.head.add(skull);
    const jaw = limb(sph(0.075), skin);
    jaw.position.set(0, -0.06, 0.03);
    jaw.scale.set(1, 0.8, 1.05);
    this.head.add(jaw);
    const hairCap = limb(new THREE.SphereGeometry(ANAT.headR * 1.03, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), hair);
    hairCap.scale.set(0.9, 1.06, 1.0);
    hairCap.rotation.x = -0.25;
    this.head.add(hairCap);
    const nose = limb(new THREE.BoxGeometry(0.03, 0.045, 0.04), skin);
    nose.position.set(0, -0.005, 0.11);
    this.head.add(nose);
    const brow = limb(new THREE.BoxGeometry(0.13, 0.02, 0.03), skin);
    brow.position.set(0, 0.03, 0.095);
    this.head.add(brow);
    g.add(this.head);

    // 팔
    this.arms = {};
    for (const s of ['lead', 'rear']) {
      const a = {
        delt: limb(sph(0.068), skin),
        upper: limb(cyl(0.052, 0.045), skin),
        elbow: limb(sph(0.045), skin),
        fore: limb(cyl(0.044, 0.038), skin),
        glove: limb(sph(ANAT.gloveR), gloves),
        cuff: limb(cyl(0.05, 0.05), trim),
      };
      a.glove.scale.set(1, 0.92, 1.15);
      for (const m of Object.values(a)) g.add(m);
      this.arms[s] = a;
    }

    // 다리
    this.legs = {};
    for (const s of ['lead', 'rear']) {
      const l = {
        short: limb(cyl(0.1, 0.085), trunks),
        thigh: limb(cyl(0.078, 0.058), skin),
        knee: limb(sph(0.058), skin),
        shin: limb(cyl(0.055, 0.042), skin),
        foot: limb(new THREE.BoxGeometry(0.09, 0.055, 0.23), skin),
      };
      for (const m of Object.values(l)) g.add(m);
      this.legs[s] = l;
    }
    this.skinMat = skin;
    this.baseSkin = new THREE.Color(pal.skin);
  }

  update(st, time) {
    const alive = st.state === 'fight';
    const bob = alive ? Math.sin(time * Math.PI * 2 * 1.7 + st.id * 1.3) * 0.012 : 0;
    const B = (p) => ({ x: p.x, y: p.y + bob, z: p.z });

    const pelvis = B(st.pelvis), chest = B(st.chest), head = B(st.head);
    let wob = 0;
    if (st.rocked && alive) wob = Math.sin(time * 9 + st.id) * 0.08;

    // 몸통 방향: 골반→가슴 축에 맞추고, 몸통 회전(torsoYaw)을 준다
    const axis = tv(chest).sub(tv(pelvis)).normalize();
    const qYaw = new THREE.Quaternion().setFromAxisAngle(Y, st.torsoYaw);
    const qAlign = new THREE.Quaternion().setFromUnitVectors(Y, axis);
    const right = new THREE.Vector3(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
    const qBend = new THREE.Quaternion().setFromAxisAngle(right, Math.min(0.6, Math.max(-0.3, st.bend * 0.6)));
    const qTorso = qBend.multiply(qAlign).multiply(qYaw);

    const mid = tv(pelvis).lerp(tv(chest), 0.45);
    this.torso.position.copy(mid);
    this.torso.quaternion.copy(qTorso);
    this.torso.scale.set(1.12, 1, 0.74);
    const breathe = st.tired && alive ? 1 + Math.sin(time * 7) * 0.035 : 1;
    this.chestMesh.position.copy(tv(chest)).addScaledVector(axis, -0.02);
    this.chestMesh.quaternion.copy(qTorso);
    this.chestMesh.scale.set(1.18 * breathe, 0.78, 0.72 * breathe);

    const qHip = new THREE.Quaternion().setFromUnitVectors(Y, axis).multiply(
      new THREE.Quaternion().setFromAxisAngle(Y, st.yaw + (st.torsoYaw - st.yaw) * 0.5));
    this.trunks.position.copy(tv(pelvis)).addScaledVector(axis, -0.02);
    this.trunks.quaternion.copy(qHip);
    this.waistband.position.copy(tv(pelvis)).addScaledVector(axis, 0.11);
    this.waistband.quaternion.copy(qHip);

    // 목과 머리
    const neckBase = tv(chest).addScaledVector(axis, 0.16);
    const headV = tv(head);
    placeLimb(this.neck, neckBase, headV.clone().addScaledVector(axis, -0.07));
    this.head.position.copy(headV);
    this.head.rotation.set(st.headRot.pitch + wob * 0.5, st.headRot.yaw, st.headRot.roll + wob, 'YXZ');

    // 팔
    for (const s of ['lead', 'rear']) {
      const a = this.arms[s], ar = st.arms[s];
      const sh = B(ar.shoulder), el = B(ar.elbow), fi = B(ar.fist);
      a.delt.position.copy(tv(sh));
      a.delt.quaternion.copy(qTorso);
      a.delt.scale.set(1, 0.95, 1);
      placeLimb(a.upper, sh, el);
      a.elbow.position.copy(tv(el));
      const fv = tv(fi), ev = tv(el);
      const dir = fv.clone().sub(ev).normalize();
      const wrist = fv.clone().addScaledVector(dir, -ANAT.gloveR * 0.9);
      placeLimb(a.fore, el, wrist);
      a.glove.position.copy(fv);
      a.glove.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      a.cuff.position.copy(wrist.clone().addScaledVector(dir, -0.01));
      a.cuff.quaternion.setFromUnitVectors(Y, dir);
      a.cuff.scale.set(1, 0.05, 1);
    }

    // 다리: 엉덩이→발 IK, 무릎은 앞쪽
    const fwd = { x: Math.sin(st.yaw), y: 0, z: Math.cos(st.yaw) };
    for (const s of ['lead', 'rear']) {
      const l = this.legs[s];
      const hip = B(st.hips[s]);
      const foot = st.feet[s];
      const ankle = { x: foot.x, y: foot.y + 0.07, z: foot.z };
      const out = s === 'lead' ? -0.3 : 0.3;
      const pole = v3(fwd.x + Math.cos(st.yaw) * out, 0.2, fwd.z - Math.sin(st.yaw) * out);
      const leg = solveArm(hip, ankle, ANAT.thigh, ANAT.shin, pole);
      const knee = leg.elbow;
      placeLimb(l.thigh, hip, knee);
      const shortEnd = tv(hip).lerp(tv(knee), 0.42);
      placeLimb(l.short, hip, shortEnd);
      l.knee.position.copy(tv(knee));
      placeLimb(l.shin, knee, ankle);
      l.foot.position.set(foot.x + fwd.x * 0.05, foot.y + 0.03, foot.z + fwd.z * 0.05);
      l.foot.rotation.set(0, st.yaw + (s === 'lead' ? 0.25 : 0.6), 0);
    }
  }

  flash(amount) {
    // 맞은 직후 피부가 살짝 붉어진다
    this.skinMat.color.copy(this.baseSkin).lerp(new THREE.Color(0xe06a5a), Math.min(0.5, amount));
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.r = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080a);
    this.scene.fog = new THREE.Fog(0x07080a, 9, 22);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
    this.camPos = new THREE.Vector3(5, 1.6, 0);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camSide = new THREE.Vector3(1, 0, 0);
    this.shakeAmt = 0;
    this.flashT = [0, 0];
    this.buildArena();
    this.fighters = [new FighterMesh(this.scene, 0), new FighterMesh(this.scene, 1)];
    this.buildParticles();
    this.buildTrails();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  buildArena() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x9fb3c8, 0x151515, 0.45));
    const key = new THREE.SpotLight(0xfff4e6, 70, 20, 0.62, 0.45, 1.4);
    key.position.set(0, 9, 0.5);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    s.add(key, key.target);
    const rimA = new THREE.DirectionalLight(0x8fb4ff, 0.7);
    rimA.position.set(-6, 4, -5);
    const rimB = new THREE.DirectionalLight(0xffc38a, 0.55);
    rimB.position.set(6, 3.5, 5);
    s.add(rimA, rimB);

    const R = CFG.ringRadius;
    // 캔버스 매트 (옥타곤)
    const mat = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.25, R + 0.25, 0.12, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.92 }));
    mat.rotation.y = Math.PI / 8;
    mat.position.y = -0.06;
    mat.receiveShadow = true;
    s.add(mat);
    // 가장자리 띠
    const band = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.05, R + 0.25, 8, 1),
      new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9 }));
    band.rotation.x = -Math.PI / 2;
    band.rotation.z = Math.PI / 8;
    band.position.y = 0.002;
    band.receiveShadow = true;
    s.add(band);
    // 가운데 원
    const center = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 0.96, 48),
      new THREE.MeshStandardMaterial({ color: 0xa8adb2, roughness: 0.9 }));
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.003;
    s.add(center);
    // 모서리 패드
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12),
        new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.7 }));
      const rr = (R + 0.25) / Math.cos(Math.PI / 8);
      post.position.set(Math.sin(a) * rr, 0.25, Math.cos(a) * rr);
      post.castShadow = true;
      s.add(post);
    }
    // 바깥 바닥
    const outer = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.121;
    outer.receiveShadow = true;
    s.add(outer);
  }

  buildParticles() {
    const N = 240;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pNext = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo = geo;
    const mat = new THREE.PointsMaterial({ color: 0xe4eef5, size: 0.022, transparent: true, opacity: 0.85, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -10;
  }

  sweat(pos, dir, power) {
    const n = Math.min(28, 4 + Math.floor(power * 1.2));
    for (let k = 0; k < n; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % this.pN;
      this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
      const sp = 1 + Math.random() * 2.5;
      this.pVel[i * 3] = dir.x * sp + (Math.random() - 0.5) * 1.6;
      this.pVel[i * 3 + 1] = dir.y * sp + Math.random() * 1.4;
      this.pVel[i * 3 + 2] = dir.z * sp + (Math.random() - 0.5) * 1.6;
      this.pLife[i] = 0.35 + Math.random() * 0.35;
    }
  }

  updateParticles(dt) {
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 9.8 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pLife[i] <= 0 || this.pPos[i * 3 + 1] < 0) { this.pLife[i] = 0; this.pPos[i * 3 + 1] = -10; }
    }
    this.pGeo.attributes.position.needsUpdate = true;
  }

  buildTrails() {
    this.trails = [];
    const colors = [0xff6b5a, 0x6ba8ff];
    for (let f = 0; f < 2; f++) {
      for (const s of ['lead', 'rear']) {
        const n = 24;
        const geo = new THREE.BufferGeometry();
        const arr = new Float32Array(n * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: colors[f], transparent: true, opacity: 0.8 }));
        line.frustumCulled = false;
        line.visible = false;
        this.scene.add(line);
        this.trails.push({ f, s, n, arr, geo, line, pts: [] });
      }
    }
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  hitFlash(i, a) { this.flashT[i] = Math.max(this.flashT[i], a); }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(snaps, dt, time, opts = {}) {
    this.fighters[0].update(snaps[0], time);
    this.fighters[1].update(snaps[1], time);
    for (let i = 0; i < 2; i++) {
      this.flashT[i] = Math.max(0, this.flashT[i] - dt * 3);
      this.fighters[i].flash(this.flashT[i]);
    }
    this.updateParticles(dt);

    // 궤도 표시 (디버그)
    for (const t of this.trails) {
      t.line.visible = !!opts.trails;
      if (!opts.trails) continue;
      t.pts.push(snaps[t.f].arms[t.s].fist);
      if (t.pts.length > t.n) t.pts.shift();
      for (let i = 0; i < t.n; i++) {
        const p = t.pts[Math.min(i, t.pts.length - 1)] || { x: 0, y: -5, z: 0 };
        t.arr[i * 3] = p.x; t.arr[i * 3 + 1] = p.y; t.arr[i * 3 + 2] = p.z;
      }
      t.geo.attributes.position.needsUpdate = true;
    }

    // 방송 중계식 측면 카메라
    const a = snaps[0].pelvis, b = snaps[1].pelvis;
    const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    const dx = b.x - a.x, dz = b.z - a.z;
    const sep = Math.hypot(dx, dz) || 1;
    const n = new THREE.Vector3(-dz / sep, 0, dx / sep);
    if (n.dot(this.camSide) < 0) n.negate();
    this.camSide.lerp(n, Math.min(1, dt * 2.5)).normalize();
    let dist = Math.min(7.5, Math.max(3.4, 2.5 + sep * 1.15));
    let height = 1.45;
    let lookY = 1.15;
    if (opts.replay) {
      dist *= 0.62;
      height = 1.25;
      lookY = 1.2;
      const orbit = new THREE.Quaternion().setFromAxisAngle(Y, Math.sin(time * 0.4) * 0.35);
      this._replaySide = this.camSide.clone().applyQuaternion(orbit);
    }
    const side = opts.replay ? this._replaySide : this.camSide;
    const wantPos = mid.clone().addScaledVector(side, dist).add(new THREE.Vector3(0, height, 0));
    const wantLook = mid.clone().add(new THREE.Vector3(0, lookY, 0));
    const k = opts.replay ? 1 : Math.min(1, dt * 3.5);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, Math.min(1, dt * 6));
    this.camera.position.copy(this.camPos);
    if (this.shakeAmt > 0.0005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 14);
    }
    this.camera.lookAt(this.camLook);
    this.r.render(this.scene, this.camera);
  }
}
