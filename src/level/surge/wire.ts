import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type FenceWireFamily = 'rising' | 'falling';

export interface FenceWireSegment {
  a: THREE.Vector2;
  b: THREE.Vector2;
  family: FenceWireFamily;
  offset: number;
}

export interface FenceWireOptions {
  /** Diamond width and height in meters. */
  pitch?: number;
  /** Wire diameter in meters. */
  thickness?: number;
  /** Cylinder side count for each batched wire segment. */
  radialSegments?: number;
}

const EPSILON = 1e-6;

/**
 * Clip both diagonal wire families to a centered rectangle in the XY plane.
 * `rising` uses x - y = offset and `falling` uses x + y = offset.
 */
export function clipFenceWires(width: number, height: number, pitch = 0.8): FenceWireSegment[] {
  if (!(width > 0) || !(height > 0) || !(pitch > 0) || ![width, height, pitch].every(Number.isFinite)) {
    throw new RangeError('Fence wire width, height, and pitch must be finite positive numbers.');
  }

  const halfW = width / 2;
  const halfH = height / 2;
  const limit = halfW + halfH;
  const first = Math.ceil(-limit / pitch) * pitch;
  const last = Math.floor(limit / pitch) * pitch;
  const segments: FenceWireSegment[] = [];

  const clip = (family: FenceWireFamily, offset: number): FenceWireSegment | null => {
    const points: THREE.Vector2[] = [];
    const add = (x: number, y: number): void => {
      if (x < -halfW - EPSILON || x > halfW + EPSILON || y < -halfH - EPSILON || y > halfH + EPSILON) return;
      const point = new THREE.Vector2(THREE.MathUtils.clamp(x, -halfW, halfW), THREE.MathUtils.clamp(y, -halfH, halfH));
      if (!points.some((existing) => existing.distanceToSquared(point) < EPSILON * EPSILON)) points.push(point);
    };

    for (const x of [-halfW, halfW]) {
      add(x, family === 'rising' ? x - offset : offset - x);
    }
    for (const y of [-halfH, halfH]) {
      add(family === 'rising' ? offset + y : offset - y, y);
    }
    if (points.length < 2) return null;

    let a = points[0], b = points[1], farthest = a.distanceToSquared(b);
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const distance = points[i].distanceToSquared(points[j]);
      if (distance > farthest) { a = points[i]; b = points[j]; farthest = distance; }
    }
    if (farthest < EPSILON * EPSILON) return null;
    return { a, b, family, offset };
  };

  for (let offset = first; offset <= last + EPSILON; offset += pitch) {
    const rising = clip('rising', offset);
    const falling = clip('falling', offset);
    if (rising) segments.push(rising);
    if (falling) segments.push(falling);
  }
  return segments;
}

/** Build one opaque, low-poly mesh containing all clipped diagonal wires. */
export function createFenceWireGeometry(width: number, height: number, options: FenceWireOptions = {}): THREE.BufferGeometry {
  const pitch = options.pitch ?? 0.8;
  const thickness = options.thickness ?? 0.04;
  const radialSegments = options.radialSegments ?? 6;
  if (!(thickness > 0) || !Number.isFinite(thickness)) throw new RangeError('Fence wire thickness must be finite and positive.');
  if (!Number.isInteger(radialSegments) || radialSegments < 3) throw new RangeError('Fence wire radialSegments must be an integer of at least 3.');

  const radius = thickness / 2;
  const segmentGeometries: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const segment of clipFenceWires(width, height, pitch)) {
    const deltaX = segment.b.x - segment.a.x;
    const deltaY = segment.b.y - segment.a.y;
    const length = Math.hypot(deltaX, deltaY);
    // Pull round caps inward so their radius stays inside the clipped rectangle.
    const usableLength = length - 2 * radius;
    if (usableLength <= EPSILON) continue;
    const direction = new THREE.Vector3(deltaX / length, deltaY / length, 0);
    const start = segment.a.clone().addScaledVector(new THREE.Vector2(direction.x, direction.y), radius);
    const end = segment.b.clone().addScaledVector(new THREE.Vector2(direction.x, direction.y), -radius);
    const geometry = new THREE.CylinderGeometry(radius, radius, usableLength, radialSegments, 1, false);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction));
    geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, 0);
    segmentGeometries.push(geometry);
  }

  const merged = segmentGeometries.length
    ? mergeGeometries(segmentGeometries, false)
    : new THREE.BufferGeometry();
  segmentGeometries.forEach((geometry) => geometry.dispose());
  if (!merged) throw new Error('Failed to merge fence wire geometry.');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.userData.fenceWire = { pitch, thickness, segmentCount: segmentGeometries.length, width, height };
  return merged;
}
