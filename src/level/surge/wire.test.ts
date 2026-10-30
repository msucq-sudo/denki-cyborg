import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clipFenceWires, createFenceWireGeometry } from './wire';

describe('surge fence wire geometry', () => {
  it('keeps the diagonal pitch and clips both wire families to the panel rectangle', () => {
    const width = 3, height = 7.8, pitch = 0.8;
    const segments = clipFenceWires(width, height, pitch);
    expect(segments.length).toBeGreaterThan(0);

    for (const segment of segments) {
      for (const point of [segment.a, segment.b]) {
        expect(point.x).toBeGreaterThanOrEqual(-width / 2 - 1e-6);
        expect(point.x).toBeLessThanOrEqual(width / 2 + 1e-6);
        expect(point.y).toBeGreaterThanOrEqual(-height / 2 - 1e-6);
        expect(point.y).toBeLessThanOrEqual(height / 2 + 1e-6);
      }
      expect(Math.abs(segment.b.x - segment.a.x)).toBeCloseTo(Math.abs(segment.b.y - segment.a.y), 5);
    }

    for (const family of ['rising', 'falling'] as const) {
      const offsets = segments.filter((segment) => segment.family === family).map((segment) => segment.offset).sort((a, b) => a - b);
      expect(offsets.length).toBeGreaterThan(2);
      for (let i = 1; i < offsets.length; i++) expect(offsets[i] - offsets[i - 1]).toBeCloseTo(pitch, 6);
    }
  });

  it('builds one thin, bounded mesh with valid positions and normals', () => {
    const width = 3, height = 7.8, thickness = 0.04;
    const geometry = createFenceWireGeometry(width, height, { pitch: 0.8, thickness, radialSegments: 6 });
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const halfT = thickness / 2;

    expect(geometry.userData.fenceWire).toEqual({ pitch: 0.8, thickness, segmentCount: 26, width, height });
    expect(position.count).toBeGreaterThan(0);
    expect(position.count).toBeLessThan(2500);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);

    const vertex = new THREE.Vector3();
    const vertexNormal = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      vertexNormal.fromBufferAttribute(normal, i);
      expect(Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z)).toBe(true);
      expect(vertex.x).toBeGreaterThanOrEqual(-width / 2 - 1e-5);
      expect(vertex.x).toBeLessThanOrEqual(width / 2 + 1e-5);
      expect(vertex.y).toBeGreaterThanOrEqual(-height / 2 - 1e-5);
      expect(vertex.y).toBeLessThanOrEqual(height / 2 + 1e-5);
      expect(Math.abs(vertex.z)).toBeLessThanOrEqual(halfT + 1e-5);
      expect(geometry.boundingSphere!.distanceToPoint(vertex)).toBeLessThanOrEqual(1e-5);
      expect(vertexNormal.length()).toBeCloseTo(1, 5);
    }

    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.rotation.y = Math.PI / 2;
    mesh.updateMatrixWorld(true);
    const normalToEast = new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
    expect(normalToEast.x).toBeCloseTo(1, 6);
    expect(normalToEast.y).toBeCloseTo(0, 6);
    expect(normalToEast.z).toBeCloseTo(0, 6);

    geometry.dispose();
    mesh.material.dispose();
  });
});
