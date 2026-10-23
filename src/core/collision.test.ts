import * as THREE from 'three';
import { makeAABB, moveCharacter, segmentAABB, segmentSphere } from './collision';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
test('segment hits box', () => {
  const b = makeAABB(V(-1, -1, -1), V(1, 1, 1));
  expect(segmentAABB(V(-5, 0, 0), V(5, 0, 0), b)).toBeCloseTo(0.4);
  expect(segmentAABB(V(-5, 3, 0), V(5, 3, 0), b)).toBeNull();
});
test('segment hits sphere', () => {
  expect(segmentSphere(V(-5, 0, 0), V(5, 0, 0), V(0, 0, 0), 1)).toBeCloseTo(0.4);
});
test('character stands on floor', () => {
  const floor = makeAABB(V(-10, -1, -10), V(10, 0, 10));
  const pos = V(0, 0.5, 0), vel = V(0, -5, 0);
  let r = { onGround: false };
  for (let i = 0; i < 30; i++) { vel.y -= 24 / 60; r = moveCharacter([floor], pos, vel, 1 / 60, 0.4, 1.8); }
  expect(r.onGround).toBe(true);
  expect(pos.y).toBeCloseTo(0, 1);
});
