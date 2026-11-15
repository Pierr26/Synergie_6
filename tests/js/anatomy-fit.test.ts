import { describe, expect, it } from 'vitest';
import { Box3, CylinderGeometry, Matrix4, Mesh, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createLegFit, fitOrganMesh } from '../../resources/js/features/body-risks/anatomy-fit';

describe('anatomy registration', () => {
    for (const sex of ['female', 'male'] as const) {
        for (const [organ, scale] of [['brain', 0.82], ['heart', 0.9]] as const) {
            it(`${sex}: preserves ${organ} proportions and orientation`, () => {
                const geometry = new SphereGeometry(0.06, 16, 12).scale(1, 1.2, 0.8).rotateZ(0.35);
                geometry.translate(0.02, organ === 'brain' ? 1.57 : 1.25, 0.01);
                const mesh = new Mesh(geometry);
                mesh.updateMatrixWorld(true);
                const before = geometry.getAttribute('position').array.slice();
                fitOrganMesh(mesh, sex, new Matrix4(), organ);
                const after = geometry.getAttribute('position');
                // Differences between all points must be a uniform scale, with no shear/rotation.
                for (let i = 1; i < after.count; i++) {
                    for (let axis = 0; axis < 3; axis++) {
                        const delta = after.array[i * 3 + axis] - after.array[axis];
                        expect(delta).toBeCloseTo((before[i * 3 + axis] - before[axis]) * scale, 6);
                    }
                }
            });
        }

        it(`${sex}: keeps the two eyeballs round and separate`, () => {
            const geometry = mergeGeometries([-1, 1].map(sign => new SphereGeometry(0.0125, 16, 12).translate(sign * 0.035, sex === 'female' ? 1.557 : 1.724, 0.08)));
            const mesh = new Mesh(geometry);
            mesh.updateMatrixWorld(true);
            fitOrganMesh(mesh, sex, new Matrix4(), 'eyes');
            const position = geometry.getAttribute('position');
            const boxes = [new Box3(), new Box3()];
            for (let i = 0; i < position.count; i++) {
                const p = new Vector3().fromBufferAttribute(position, i);
                boxes[p.x < 0 ? 0 : 1].expandByPoint(p);
            }
            for (const box of boxes) {
                const size = box.getSize(new Vector3());
                expect(size.x).toBeCloseTo(size.y, 5);
                expect(size.y).toBeCloseTo(size.z, 5);
            }
            expect(boxes[0].max.x).toBeLessThan(boxes[1].min.x);
            expect(geometry.getAttribute('eyeLocal').count).toBe(position.count);
        });

        it(`${sex}: keeps leg bones inside differently spaced, narrower legs`, () => {
            const legs = (radius: number, spacing: number, z = 0) => new Mesh(mergeGeometries([-1, 1].map(sign =>
                new CylinderGeometry(radius, radius, 1, 32, 32).translate(sign * spacing, 0.5, z))));
            const source = legs(0.075, 0.13);
            const target = legs(0.055, 0.10, 0.02);
            source.updateMatrixWorld(true); target.updateMatrixWorld(true);
            const bone = new Mesh(mergeGeometries([-1, 1].map(sign => new CylinderGeometry(0.018, 0.018, 0.40, 12, 16).translate(sign * 0.13, 0.35, 0))));
            bone.updateMatrixWorld(true);
            fitOrganMesh(bone, sex, new Matrix4(), 'bones', createLegFit(source, target, new Matrix4(), sex));
            const p = new Vector3(), vertices = bone.geometry.getAttribute('position');
            for (let i = 0; i < vertices.count; i++) {
                p.fromBufferAttribute(vertices, i);
                expect(Math.hypot(p.x - Math.sign(p.x) * 0.10, p.z - 0.02)).toBeLessThan(0.055);
            }
        });
    }
});
