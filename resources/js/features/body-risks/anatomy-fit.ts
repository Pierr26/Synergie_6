import { Box3, Float32BufferAttribute, Matrix3, Matrix4, Vector3, type Mesh } from 'three';
import type { Sex } from './body3d';

// Measured in the viewer after the reference body and the mockup silhouette
// have been centred on the turntable and brought to the same standing height.
// Interpolate between slices so that long layers (like vessels and bones)
// stay connected while following the proportions of each silhouette.
type Slice = [
    sourceY: number, targetY: number, widthScale: number,
    depthScale: number, depthShift: number,
];

const SLICES: Record<Sex, readonly Slice[]> = {
    female: [
        [0, 0, 0.98, 0.92, 0.008],           // feet
        [0.45, 0.37, 0.99, 0.84, -0.025],  // knees
        [0.80, 0.73, 0.91, 0.86, 0.013],   // hips
        [1.05, 1.04, 0.83, 0.68, 0.035],   // waist
        [1.26, 1.23, 0.88, 0.84, 0.016],   // chest
        [1.41, 1.37, 0.91, 0.88, 0.011],   // shoulders
        [1.49, 1.44, 0.94, 0.92, 0.006],   // jaw
        [1.558, 1.511, 0.97, 0.92, 0.012], // eyes
        [1.65, 1.626, 0.94, 0.87, -0.008], // scalp below the bun
    ],
    male: [
        [0, 0, 0.94, 0.88, -0.054],         // feet
        [0.53, 0.49, 1.00, 0.78, -0.107],  // knees
        [0.93, 0.92, 0.83, 0.80, -0.116],  // hips
        [1.14, 1.11, 0.89, 0.73, -0.119],  // waist
        [1.41, 1.36, 0.96, 0.80, -0.102],  // chest
        [1.57, 1.54, 0.99, 0.88, -0.103],  // shoulders
        [1.66, 1.62, 0.96, 0.89, -0.092],  // jaw
        [1.724, 1.742, 0.98, 0.88, -0.081], // upper face
        [1.824, 1.815, 0.95, 0.86, -0.098], // scalp
    ],
};

export function fitAnatomyPoint(point: Vector3, sex: Sex, normal?: Vector3): Vector3 {
    const slices = SLICES[sex];
    const upper = slices.findIndex(([y]) => point.y < y);
    const last = upper < 0 ? slices.length - 1 : Math.max(1, upper);
    const [y0, target0, width0, depth0, shift0] = slices[last - 1];
    const [y1, target1, width1, depth1, shift1] = slices[last];
    const span = y1 - y0;
    const weight = (point.y - y0) / span;
    const blend = (a: number, b: number) => a + weight * (b - a);
    const width = blend(width0, width1);
    const depth = blend(depth0, depth1);
    if (normal) {
        // Transform the supplied normals by the inverse transpose of this slice's
        // deformation. Rebuilding them would lose smoothing across split vertices.
        const nx = normal.x / width;
        const nz = normal.z / depth;
        const dx = point.x * (width1 - width0);
        const dz = point.z * (depth1 - depth0) + shift1 - shift0;
        normal.set(nx, (normal.y * span - nx * dx - nz * dz) / (target1 - target0), nz);
    }
    return point.set(
        point.x * width,
        blend(target0, target1),
        point.z * depth + blend(shift0, shift1),
    );
}

interface LegSection { minX: number; maxX: number; minZ: number; maxZ: number }
type LegProfile = (LegSection | undefined)[][];
const SECTION_HEIGHT = 0.012;

/** Sample each leg separately: a global body width cannot register two differently posed legs. */
function legProfile(mesh: Mesh, bodyWorld: Matrix4, lateralLimit: number): LegProfile {
    const profile: LegProfile = [[], []];
    const transform = bodyWorld.clone().invert().multiply(mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position');
    const p = new Vector3();
    const vertices: Vector3[] = [];
    for (let i = 0; i < position.count; i++) {
        vertices.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(transform));
    }
    const add = (index: number) => {
        // Exclude the hands/forearms, which can be at the same height as a thigh.
        if (Math.abs(p.x) > lateralLimit) return;
        const leg = profile[p.x < 0 ? 0 : 1];
        const section = leg[index] ??= { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z };
        section.minX = Math.min(section.minX, p.x); section.maxX = Math.max(section.maxX, p.x);
        section.minZ = Math.min(section.minZ, p.z); section.maxZ = Math.max(section.maxZ, p.z);
    };
    const indices = mesh.geometry.getIndex();
    const count = indices?.count ?? position.count;
    // Intersect triangles with actual horizontal planes. Sampling only vertices made the
    // low-poly reference skin produce discontinuous widths and bent the femurs into waves.
    for (let i = 0; i < count; i += 3) {
        const triangle = [0, 1, 2].map(j => vertices[indices ? indices.getX(i + j) : i + j]);
        const minY = Math.min(...triangle.map(v => v.y));
        const maxY = Math.max(...triangle.map(v => v.y));
        const first = Math.max(0, Math.ceil(minY / SECTION_HEIGHT - 0.5));
        const last = Math.min(Math.floor(1 / SECTION_HEIGHT), Math.floor(maxY / SECTION_HEIGHT - 0.5));
        for (let index = first; index <= last; index++) {
            const y = (index + 0.5) * SECTION_HEIGHT;
            for (let edge = 0; edge < 3; edge++) {
                const a = triangle[edge], b = triangle[(edge + 1) % 3];
                if ((a.y < y) === (b.y < y) || Math.abs(b.y - a.y) < 1e-9) continue;
                p.copy(a).lerp(b, (y - a.y) / (b.y - a.y));
                add(index);
            }
        }
    }
    return profile;
}

function sectionAt(profile: LegProfile, side: number, y: number): LegSection | undefined {
    const slice = y / SECTION_HEIGHT - 0.5;
    const lo = Math.max(0, Math.floor(slice));
    const a = profile[side][lo], b = profile[side][lo + 1];
    if (!a || !b) return a ?? b;
    const t = Math.max(0, slice - lo);
    const blend = (x: number, y: number) => x * (1 - t) + y * t;
    return { minX: blend(a.minX, b.minX), maxX: blend(a.maxX, b.maxX), minZ: blend(a.minZ, b.minZ), maxZ: blend(a.maxZ, b.maxZ) };
}

export interface LegFit { source: LegProfile; target: LegProfile }

export function createLegFit(sourceSkin: Mesh, targetSkin: Mesh, bodyWorld: Matrix4, sex: Sex): LegFit {
    const lateralLimit = sex === 'female' ? 0.24 : 0.28;
    return { source: legProfile(sourceSkin, bodyWorld, lateralLimit), target: legProfile(targetSkin, bodyWorld, lateralLimit) };
}

function fitLeg(point: Vector3, original: Vector3, sex: Sex, fit: LegFit): void {
    const hip = sex === 'female' ? 0.80 : 0.93;
    if (original.y >= hip) return;
    const side = original.x < 0 ? 0 : 1;
    const source = sectionAt(fit.source, side, original.y);
    const target = sectionAt(fit.target, side, point.y);
    if (!source || !target) return;
    const blend = Math.max(0, Math.min(1, (hip - original.y) / 0.10));
    for (const axis of ['x', 'z'] as const) {
        const min = axis === 'x' ? 'minX' : 'minZ', max = axis === 'x' ? 'maxX' : 'maxZ';
        const span = source[max] - source[min];
        if (span < 0.006) continue;
        const relative = Math.max(-0.92, Math.min(0.92, (original[axis] - (source[min] + source[max]) / 2) / (span / 2)));
        const inset = relative * (target[max] - target[min]) * 0.42;
        point[axis] += blend * ((target[min] + target[max]) / 2 + inset - point[axis]);
    }
}

export function fitOrganMesh(mesh: Mesh, sex: Sex, bodyWorld: Matrix4, organ: string, legs?: LegFit): void {
    const toBody = bodyWorld.clone().invert().multiply(mesh.matrixWorld);
    const toMesh = toBody.clone().invert();
    const geometry = mesh.geometry;
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    const source = geometry.getAttribute('position');
    const sourceNormals = geometry.getAttribute('normal');
    const positions = new Float32Array(source.count * 3);
    const normals = new Float32Array(source.count * 3);
    const normalToBody = new Matrix3().getNormalMatrix(toBody);
    const normalToMesh = new Matrix3().getNormalMatrix(toMesh);
    const point = new Vector3();
    const normal = new Vector3();
    const original = new Vector3();
    const bounds = new Box3();
    for (let i = 0; i < source.count; i++) bounds.expandByPoint(original.fromBufferAttribute(source, i).applyMatrix4(toBody));
    const centre = bounds.getCenter(new Vector3());
    const targetCentre = fitAnatomyPoint(centre.clone(), sex);
    // A brain and a heart are rigid organs. Stretching each vertex through body-height slices
    // elongated the brain into the face and sheared the heart's natural oblique orientation.
    if (organ === 'brain') targetCentre.set(0, sex === 'female' ? 1.562 : 1.744, sex === 'female' ? -0.007 : -0.092);
    const eyeBounds = [new Box3(), new Box3()];
    if (organ === 'eyes') {
        for (let i = 0; i < source.count; i++) {
            original.fromBufferAttribute(source, i).applyMatrix4(toBody);
            eyeBounds[original.x < 0 ? 0 : 1].expandByPoint(original);
        }
    }
    const eyeCentres = eyeBounds.map(b => b.getCenter(new Vector3()));
    const eyeLocal = new Float32Array(source.count * 3);
    // The male shell's eye sockets sit lower than the general head fit.
    const eyeOffsetY = organ === 'eyes' && sex === 'male' ? -0.04 : 0;
    for (let i = 0; i < source.count; i++) {
        point.fromBufferAttribute(source, i).applyMatrix4(toBody);
        original.copy(point);
        normal.fromBufferAttribute(sourceNormals, i).applyNormalMatrix(normalToBody);
        if (organ === 'brain' || organ === 'heart') {
            point.sub(centre).multiplyScalar(organ === 'brain' ? 0.82 : 0.9).add(targetCentre);
        } else if (organ === 'eyes') {
            const eyeCentre = eyeCentres[point.x < 0 ? 0 : 1];
            point.sub(eyeCentre);
            point.clone().divideScalar(0.0125).toArray(eyeLocal, i * 3);
            point.multiplyScalar(0.90).add(fitAnatomyPoint(eyeCentre.clone(), sex));
        } else {
            fitAnatomyPoint(point, sex, normal);
            if (legs && (organ === 'bones' || organ === 'muscles')) fitLeg(point, original, sex, legs);
        }
        point.y += eyeOffsetY;
        point.applyMatrix4(toMesh).toArray(positions, i * 3);
        normal.applyNormalMatrix(normalToMesh).toArray(normals, i * 3);
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    if (organ === 'eyes') geometry.setAttribute('eyeLocal', new Float32BufferAttribute(eyeLocal, 3));
    if (organ === 'bones' || organ === 'muscles') geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}
