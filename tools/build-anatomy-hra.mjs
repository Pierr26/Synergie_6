// Builds the light anatomy models used by Body & Risks from the HuBMAP Human Reference Atlas
// "united" 3D reference bodies (male and female), CC BY 4.0:
//   https://cdn.humanatlas.io/digital-objects/ref-organ/united-male/latest/assets/3d-vh-m-united.glb
//   https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/latest/assets/3d-vh-f-united.glb
// Each system below is baked to world space, merged into one mesh, simplified and meshopt-compressed.
// Run from a scratch folder with @gltf-transform/{core,extensions,functions} and meshoptimizer installed:
//   node build-anatomy-hra.mjs united-m.glb anatomy-male.glb M
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, prune, quantize, reorder, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [inp, out, sex] = process.argv.slice(2);
const P = `VH_${sex}_`;
// system -> [source node names, triangle budget]
const GROUPS = {
    skin: [[`${P}skin`], 40000],
    brain: [['Allen_brain'], 30000],
    eyes: [[`${P}eyes`], 5000],
    heart: [[`${P}heart`], 24000],
    vessels: [[`${P}blood_vasculature`], 46000],
    lungs: [[`${P}lungs`, `${P}tracheobronchial_tree`], 30000],
    kidneys: [[`${P}upper_urinary_tract`], 14000],
    bones: [[`${P}vertebral_column`, `${P}pelvis`, `${P}lower_limb`, `${P}sternum`, `${P}manubrium`, `${P}hyoid`], 60000],
    muscles: [[`${P}muscles_of_knee`], 8000],
    digestive: [[`${P}liver`, `${P}small_intestine`, `${P}colon`, `${P}pancreas`, `${P}gallbladder_`, `${P}spleen`], 30000],
};

await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const src = await io.read(inp);
const byName = new Map(src.getRoot().listNodes().map((n) => [n.getName(), n]));

function collect(node, acc) {
    const mesh = node.getMesh();
    if (mesh) acc.push([node.getWorldMatrix(), mesh]);
    for (const c of node.listChildren()) collect(c, acc);
    return acc;
}

const doc = new Document();
doc.getRoot().getAsset().copyright = 'HuBMAP Human Reference Atlas 3D reference organs (Visible Human, Allen brain), CC BY 4.0. Regrouped and simplified for QUINTA.';
const buffer = doc.createBuffer();
const scene = doc.createScene('anatomy');
const material = doc.createMaterial('anatomy').setRoughnessFactor(0.6).setMetallicFactor(0);

for (const [name, [sources, budget]] of Object.entries(GROUPS)) {
    const parts = sources.flatMap((s) => (byName.has(s) ? collect(byName.get(s), []) : []));
    let nv = 0;
    let ni = 0;
    const prims = [];
    for (const [m, mesh] of parts) {
        for (const prim of mesh.listPrimitives()) {
            const pos = prim.getAttribute('POSITION');
            if (!pos || prim.getMode() !== 4) continue;
            const idx = prim.getIndices();
            prims.push([m, pos, prim.getAttribute('NORMAL'), idx]);
            nv += pos.getCount();
            ni += idx ? idx.getCount() : pos.getCount();
        }
    }
    if (!nv) {
        console.log(name, 'missing in source, skipped');
        continue;
    }
    const P3 = new Float32Array(nv * 3);
    const N3 = new Float32Array(nv * 3);
    const I = new Uint32Array(ni);
    let vo = 0;
    let io2 = 0;
    const v = [0, 0, 0];
    for (const [m, pos, nor, idx] of prims) {
        const n = pos.getCount();
        // mirrored transforms flip the winding
        const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
        for (let i = 0; i < n; i++) {
            pos.getElement(i, v);
            const [x, y, z] = v;
            P3[(vo + i) * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
            P3[(vo + i) * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
            P3[(vo + i) * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
            if (nor) {
                nor.getElement(i, v);
                const [a, b, c] = v;
                let nx = m[0] * a + m[4] * b + m[8] * c;
                let ny = m[1] * a + m[5] * b + m[9] * c;
                let nz = m[2] * a + m[6] * b + m[10] * c;
                const l = Math.hypot(nx, ny, nz) || 1;
                N3[(vo + i) * 3] = nx / l;
                N3[(vo + i) * 3 + 1] = ny / l;
                N3[(vo + i) * 3 + 2] = nz / l;
            }
        }
        const cnt = idx ? idx.getCount() : n;
        for (let i = 0; i < cnt; i += 3) {
            const a = idx ? idx.getScalar(i) : i;
            const b = idx ? idx.getScalar(i + 1) : i + 1;
            const c = idx ? idx.getScalar(i + 2) : i + 2;
            I[io2 + i] = vo + a;
            I[io2 + i + 1] = vo + (det < 0 ? c : b);
            I[io2 + i + 2] = vo + (det < 0 ? b : c);
        }
        vo += n;
        io2 += cnt;
    }
    const prim = doc
        .createPrimitive()
        .setMaterial(material)
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P3).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(buffer));
    weldPrimitive(prim, {});
    const before = prim.getIndices().getCount() / 3;
    let after = before;
    let mode = 'kept';
    if (before > budget) {
        // 'Prune' drops tiny disconnected shells that would otherwise stall the simplifier (vessels, vertebrae)
        const positions = new Float32Array(prim.getAttribute('POSITION').getArray());
        const [res, err] = MeshoptSimplifier.simplify(new Uint32Array(prim.getIndices().getArray()), positions, 3, budget * 3, 0.012, ['Prune']);
        prim.getIndices().setArray(new Uint32Array(res));
        after = res.length / 3;
        mode = `error ${err.toFixed(4)}`;
        if (after > budget * 1.3) {
            // error-bound reached first (small or very fragmented systems): grid-based pass down to the budget
            const [res2] = MeshoptSimplifier.simplifySloppy(new Uint32Array(prim.getIndices().getArray()), positions, 3, null, budget * 3, 0.03);
            prim.getIndices().setArray(new Uint32Array(res2));
            after = res2.length / 3;
            mode += ' + sloppy';
        }
        compactPrimitive(prim);
    }
    // smooth vertex normals, area-weighted (source normals are dropped so that seams weld)
    {
        const pa = prim.getAttribute('POSITION').getArray();
        const ia = prim.getIndices().getArray();
        const na = new Float32Array(pa.length);
        for (let t = 0; t < ia.length; t += 3) {
            const [i0, i1, i2] = [ia[t] * 3, ia[t + 1] * 3, ia[t + 2] * 3];
            const ux = pa[i1] - pa[i0], uy = pa[i1 + 1] - pa[i0 + 1], uz = pa[i1 + 2] - pa[i0 + 2];
            const wx = pa[i2] - pa[i0], wy = pa[i2 + 1] - pa[i0 + 1], wz = pa[i2 + 2] - pa[i0 + 2];
            const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            for (const k of [i0, i1, i2]) {
                na[k] += nx;
                na[k + 1] += ny;
                na[k + 2] += nz;
            }
        }
        for (let k = 0; k < na.length; k += 3) {
            const l = Math.hypot(na[k], na[k + 1], na[k + 2]) || 1;
            na[k] /= l;
            na[k + 1] /= l;
            na[k + 2] /= l;
        }
        prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(na).setBuffer(buffer));
    }
    const bb = [P3.reduce((a, x, i) => (i % 3 === 1 ? Math.min(a, x) : a), Infinity), P3.reduce((a, x, i) => (i % 3 === 1 ? Math.max(a, x) : a), -Infinity)];
    console.log(name.padEnd(10), String(before).padStart(8), '->', String(after).padStart(6), mode, 'y', bb.map((x) => x.toFixed(3)).join('..'));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}
await doc.transform(prune(), dedup(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14, quantizeNormal: 8 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(out, doc);
