import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Mesh, TextureLoader, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Sex } from './body3d';

/** The female mockup shell is a compact, quantised static mesh; the male is a GLB. */
export async function loadMockShell(sex: Sex): Promise<{ model: Object3D; mesh: Mesh; normalMap: Texture | null } | null> {
    if (sex === 'male') {
        const gltf = await new GLTFLoader().loadAsync('/assets/models/mock-shell-male.glb');
        const meshes: Mesh[] = [];
        gltf.scene.traverse((o) => {
            if ((o as Mesh).isMesh) meshes.push(o as Mesh);
        });
        const mesh = meshes[0];
        if (!mesh) throw new Error('Male mockup shell has no mesh');
        const material = mesh.material;
        const normalMap = !Array.isArray(material) && 'normalMap' in material ? material.normalMap as Texture | null : null;
        return { model: gltf.scene, mesh, normalMap };
    }

    const response = await fetch('/assets/models/mock-shell-female.bin');
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Female mockup shell: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);
    const headerSize = view.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerSize))) as {
        n: number; i: number; mn: [number, number, number]; mx: [number, number, number];
    };
    if (header.n <= 0 || header.i <= 0 || header.n > 1_000_000 || header.i > 3_000_000) throw new Error('Invalid female mockup shell');
    let offset = 4 + headerSize;
    const quantised = new Int16Array(buffer, offset, header.n * 3);
    offset += header.n * 6;
    offset = (offset + 3) & ~3;
    const packedNormals = new Int8Array(buffer, offset, header.n * 4);
    offset += header.n * 4;
    const packedUvs = new Uint16Array(buffer, offset, header.n * 2);
    offset += header.n * 4;
    const indices = new Uint32Array(buffer, offset, header.i);
    const positions = new Float32Array(header.n * 3);
    const normals = new Float32Array(header.n * 3);
    const uvs = new Float32Array(header.n * 2);
    for (let i = 0; i < header.n; i++) {
        for (let axis = 0; axis < 3; axis++) {
            const j = i * 3 + axis;
            positions[j] = header.mn[axis] + ((quantised[j] + 32768) / 65535) * (header.mx[axis] - header.mn[axis]);
            normals[j] = packedNormals[i * 4 + axis] / 127;
        }
        uvs[i * 2] = packedUvs[i * 2] / 65535;
        uvs[i * 2 + 1] = packedUvs[i * 2 + 1] / 65535;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    const mesh = new Mesh(geometry);
    mesh.frustumCulled = false;
    const model = new Group();
    model.add(mesh);
    const normalMap = await new TextureLoader().loadAsync('/assets/models/mock-shell-female-normal.jpg');
    normalMap.flipY = false;
    return { model, mesh, normalMap };
}
