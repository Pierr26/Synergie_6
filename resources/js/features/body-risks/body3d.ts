/**
 * 3D anatomy viewer, loaded on demand (dynamic import).
 * Models: public/assets/models/anatomy-{male,female}.glb, built by tools/build-anatomy-hra.mjs from the
 * HuBMAP Human Reference Atlas 3D reference bodies (Visible Human male and female, CC BY 4.0).
 * One mesh per system: skin, brain, eyes, heart, vessels, lungs, kidneys, bones, muscles, digestive.
 * Motion is procedural and illustrative only (fixed loops, never driven by crew measurements).
 * Rendering stops when the page is hidden or the viewer is detached.
 */
import {
    AdditiveBlending,
    Box3,
    CanvasTexture,
    CircleGeometry,
    Color,
    DirectionalLight,
    FrontSide,
    Group,
    HemisphereLight,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    PMREMGenerator,
    RingGeometry,
    Scene,
    ShaderMaterial,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer,
    ACESFilmicToneMapping,
    type IUniform,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { REGIONS, type RegionId } from './content';

export type LayerId = 'skin' | 'vessels' | 'bones' | 'digestive';
export type Sex = 'female' | 'male';

export interface Viewer {
    select(id: RegionId): void;
    play(): void;
    pause(): void;
    playing(): boolean;
    view(angle: number): void;
    zoom(delta: number): void;
    reset(): void;
    layer(id: LayerId, on: boolean): void;
    attach(host: HTMLElement): void;
    dispose(): void;
}

const MODEL_URL: Record<Sex, string> = { female: '/assets/models/anatomy-female.glb', male: '/assets/models/anatomy-male.glb' };

type MeshId = 'skin' | 'brain' | 'eyes' | 'heart' | 'vessels' | 'lungs' | 'kidneys' | 'bones' | 'muscles' | 'digestive';

/** Colours come from the QUINTA palette (coral, amber, ciel, menthe) and its hero tints. */
const TINT: Record<Exclude<MeshId, 'skin'>, string> = {
    brain: '#f3b3a3',
    eyes: '#4fa9c2',
    heart: '#e2735f',
    vessels: '#d0604c',
    digestive: '#e8b98a',
    lungs: '#f3a595',
    kidneys: '#d9962a',
    bones: '#eaf4f0',
    muscles: '#c9604e',
};

interface Focus {
    mesh: Exclude<MeshId, 'skin'> | null;
    /** camera distance and body angle (radians, 0 = front) when the region is selected */
    dist: number;
    angle: number;
    sweep: { axis: [number, number, number]; period: number; color: string; amount: number };
}

const FOCUS: Record<RegionId, Focus> = {
    brain: { mesh: 'brain', dist: 1.25, angle: 0.5, sweep: { axis: [0, 0, -1], period: 2.4, color: '#9ee6cf', amount: 0.6 } },
    eyes: { mesh: 'eyes', dist: 1.1, angle: 0.25, sweep: { axis: [1, 0, 0], period: 1.8, color: '#ffffff', amount: 0.7 } },
    'inner-ear': { mesh: null, dist: 1.15, angle: -1.1, sweep: { axis: [0, 1, 0], period: 2, color: '#9ee6cf', amount: 0 } },
    heart: { mesh: 'heart', dist: 1.45, angle: 0.3, sweep: { axis: [0, -1, 0], period: 1, color: '#ffd3a5', amount: 0.35 } },
    lungs: { mesh: 'lungs', dist: 1.6, angle: 0.3, sweep: { axis: [0, 1, 0], period: 4.5, color: '#ffffff', amount: 0.3 } },
    kidneys: { mesh: 'kidneys', dist: 1.5, angle: Math.PI - 0.3, sweep: { axis: [0, -1, 0], period: 2.6, color: '#4fa9c2', amount: 0.6 } },
    bones: { mesh: 'bones', dist: 2.9, angle: 0.45, sweep: { axis: [0, 1, 0], period: 3.6, color: '#9ee6cf', amount: 0.75 } },
    'leg-muscles': { mesh: 'muscles', dist: 2.1, angle: 0.5, sweep: { axis: [0, 1, 0], period: 2.2, color: '#ffd3a5', amount: 0.45 } },
};

const D_MAX = 3.9;
const D_MIN = 0.9;

function radial(stops: [number, string][]): CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
}

interface Organ {
    mesh: Mesh;
    /** group placed at the organ centre: scaling it pulses the organ in place */
    pivot: Group;
    mat: MeshStandardMaterial;
    centre: Vector3;
    sweep: { uAxis: IUniform<Vector3>; uPos: IUniform<number>; uAmt: IUniform<number>; uCol: IUniform<Color>; uWidth: IUniform<number> };
    /** current and target visibility level (0–1) */
    level: number;
    want: number;
    min: number;
    max: number;
}

export async function createViewer(host: HTMLElement, opts: { initial: RegionId; sex: Sex; onSelect: (id: RegionId) => void; onProgress?: (ratio: number) => void }): Promise<Viewer> {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'v3d-canvas';

    // persistent stage: canvas + marker overlay + tag, moved as one block on re-render
    const stage = document.createElement('div');
    stage.className = 'v3d-stage';
    const layerEl = document.createElement('div');
    layerEl.className = 'markers';
    const tag = document.createElement('div');
    tag.className = 'tag3d';
    tag.setAttribute('aria-hidden', 'true');
    tag.innerHTML = '<i></i><span></span>';
    stage.append(canvas, layerEl, tag);
    host.prepend(stage);

    const scene = new Scene();
    const pm = new PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new PerspectiveCamera(30, 1, 0.05, 50);
    const key = new DirectionalLight(0xfff1e2, 1.3);
    key.position.set(1.8, 4, 3);
    const rim = new DirectionalLight(0x9ee6cf, 1.0);
    rim.position.set(-2.6, 2.4, -2.8);
    const rim2 = new DirectionalLight(0xcfe9f5, 0.6);
    rim2.position.set(2.8, 1.6, -2.4);
    scene.add(key, rim, rim2, new HemisphereLight(0xffffff, 0x9fbfb6, 0.5));

    // floor: contact shadow, pad, ring and a slowly turning dashed ring (as in the mockup)
    const flat = (m: Mesh, y: number) => {
        m.rotation.x = -Math.PI / 2;
        m.position.y = y;
        scene.add(m);
        return m;
    };
    flat(new Mesh(new PlaneGeometry(0.95, 0.7), new MeshBasicMaterial({ map: radial([[0, 'rgba(23,58,56,.42)'], [0.22, 'rgba(23,58,56,.22)'], [0.6, 'rgba(23,58,56,.06)'], [1, 'rgba(23,58,56,0)']]), transparent: true, depthWrite: false })), 0.003);
    flat(new Mesh(new CircleGeometry(0.62, 96), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false })), 0.001);
    flat(new Mesh(new RingGeometry(0.6, 0.604, 160), new MeshBasicMaterial({ color: 0x2f7f74, transparent: true, opacity: 0.35, depthWrite: false })), 0.004);
    const dash = new Group();
    for (let i = 0; i < 36; i++) {
        const seg = new Mesh(new RingGeometry(0.5, 0.507, 6, 1, (i * Math.PI * 2) / 36, ((Math.PI * 2) / 36) * 0.55), new MeshBasicMaterial({ color: 0x4fa9c2, transparent: true, opacity: 0.55, depthWrite: false }));
        seg.rotation.x = -Math.PI / 2;
        dash.add(seg);
    }
    dash.position.y = 0.005;
    scene.add(dash);

    const body = new Group();
    scene.add(body);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(MODEL_URL[opts.sex], (e) => {
        if (e.total) opts.onProgress?.(e.loaded / e.total);
    });
    // centre the body on the turntable axis
    // face the camera: in the source the eyes sit in front of the brain along Z
    const part = (n: string) => new Box3().setFromObject(gltf.scene.getObjectByName(n)!).getCenter(new Vector3());
    if (part('eyes').z < part('brain').z) gltf.scene.rotation.y = Math.PI;
    gltf.scene.updateMatrixWorld(true);
    const skinBox = new Box3().setFromObject(gltf.scene.getObjectByName('skin')!);
    const mid = skinBox.getCenter(new Vector3());
    gltf.scene.position.set(-mid.x, -skinBox.min.y, -mid.z);
    body.add(gltf.scene);
    body.updateMatrixWorld(true);

    // skin: translucent rim-lit shell with a travelling scan band
    const skinU = {
        uRim: { value: new Color('#3fb89a') },
        uBase: { value: new Color('#8fa39c') },
        uAlpha: { value: 1 },
        uScanY: { value: -1 },
        uScanAmt: { value: 0 },
    };
    const skinMat = new ShaderMaterial({
        uniforms: skinU,
        transparent: true,
        depthWrite: false,
        side: FrontSide,
        vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
            void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = (modelMatrix * vec4(position,1.0)).y; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uRim; uniform vec3 uBase; uniform float uAlpha; uniform float uScanY; uniform float uScanAmt; varying vec3 vN; varying vec3 vV; varying float vY;
            void main(){ float fr = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.1);
              float band = exp(-pow((vY - uScanY) / 0.02, 2.0));
              float lines = smoothstep(0.82, 1.0, abs(sin(vY * 260.0))) * exp(-pow((vY - uScanY) / 0.09, 2.0));
              float scan = clamp((band * 0.8 + lines * 0.35) * uScanAmt, 0.0, 1.0);
              vec3 col = mix(uBase, uRim, fr * 0.85) + uRim * scan * 0.6;
              float a = (0.07 + 0.78 * fr) * uAlpha + scan * 0.5 * step(0.01, uAlpha);
              gl_FragColor = vec4(col, clamp(a, 0.0, 1.0)); }`,
    });

    const organs = new Map<Exclude<MeshId, 'skin'>, Organ>();
    let skin: Mesh | null = null;
    const found: Mesh[] = [];
    gltf.scene.traverse((o) => {
        if ((o as Mesh).isMesh) found.push(o as Mesh);
    });
    for (const m of found) {
        const name = (m.name || m.parent?.name || '') as MeshId;
        m.frustumCulled = false;
        if (name === 'skin') {
            m.material = skinMat;
            m.renderOrder = 5;
            skin = m;
            continue;
        }
        if (!(name in TINT)) continue;
        const id = name as Exclude<MeshId, 'skin'>;
        const sweep = { uAxis: { value: new Vector3(0, 1, 0) }, uPos: { value: -9 }, uAmt: { value: 0 }, uCol: { value: new Color('#ffffff') }, uWidth: { value: 0.03 } };
        const mat = new MeshStandardMaterial({ color: new Color(TINT[id]), roughness: id === 'bones' ? 0.7 : 0.5, metalness: 0, envMapIntensity: 0.55, transparent: true, opacity: 1 });
        mat.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, sweep);
            sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            sh.fragmentShader =
                'varying vec3 vWP;\nuniform vec3 uAxis; uniform float uPos; uniform float uAmt; uniform vec3 uCol; uniform float uWidth;\n' +
                sh.fragmentShader.replace('#include <opaque_fragment>', 'float sb = exp(-pow((dot(vWP, uAxis) - uPos) / uWidth, 2.0));\n outgoingLight = mix(outgoingLight, uCol, clamp(sb * uAmt, 0.0, 1.0));\n#include <opaque_fragment>');
        };
        m.material = mat;
        m.renderOrder = id === 'bones' ? 1 : id === 'muscles' ? 3 : 2;
        const centre = new Box3().setFromObject(m).getCenter(new Vector3());
        // rest levels: organs glow softly through the shell, skeleton and muscles stay discreet
        const min = id === 'bones' || id === 'muscles' || id === 'digestive' || id === 'vessels' ? 0 : 0.4;
        const pivot = new Group();
        const parent = m.parent!;
        pivot.position.copy(parent.worldToLocal(centre.clone()));
        parent.add(pivot);
        pivot.updateMatrixWorld(true);
        pivot.attach(m);
        organs.set(id, { mesh: m, pivot, mat, centre, sweep, level: min, want: min, min, max: 1 });
    }
    if (!skin || organs.size < 9) throw new Error('anatomy model is incomplete');

    // markers: HTML buttons projected on the organs (pointer users); the region list is the accessible path
    const anchors = new Map<RegionId, Vector3>();
    const marks = new Map<RegionId, HTMLButtonElement>();
    for (const r of REGIONS) {
        const f = FOCUS[r.id];
        // the inner ear has no mesh: place it beside the head, behind the eyes
        const local = f.mesh ? body.worldToLocal(organs.get(f.mesh)!.centre.clone()) : body.worldToLocal(organs.get('eyes')!.centre.clone()).add(new Vector3(0.074, -0.004, -0.085));
        anchors.set(r.id, local);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mk3';
        b.tabIndex = -1;
        b.setAttribute('aria-hidden', 'true');
        b.title = r.name;
        b.innerHTML = '<i></i>';
        b.addEventListener('click', () => opts.onSelect(r.id));
        layerEl.append(b);
        marks.set(r.id, b);
    }

    const halo = new Sprite(new SpriteMaterial({ map: radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]), color: 0x9ee6cf, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, opacity: 0.5 }));
    halo.scale.set(0.16, 0.16, 1);
    halo.renderOrder = 10;
    halo.visible = false;
    body.add(halo);

    /* ------------------------------------------------------------ interaction */
    let rotY = 0.3;
    let rotX = 0.04;
    let velY = 0;
    let targetY: number | null = null;
    let dist = D_MAX;
    let targetDist = D_MAX;
    let idle = 0;
    let zoomed = false;
    let current: RegionId = opts.initial;
    let isPlaying = !reduced;
    const layers: Record<LayerId, boolean> = { skin: true, vessels: true, bones: false, digestive: false };
    const look = new Vector3(0, 0.9, 0);
    const lookT = new Vector3();
    const nearest = (a: number) => a + Math.round((rotY - a) / (2 * Math.PI)) * 2 * Math.PI;

    let down: { x: number; y: number; ry: number; rx: number; moved: boolean } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
        down = { x: e.clientX, y: e.clientY, ry: rotY, rx: rotX, moved: false };
        idle = 0;
        targetY = null;
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add('drag');
        kick();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!down) return;
        const ny = down.ry + (e.clientX - down.x) * 0.01;
        if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) down.moved = true;
        velY = ny - rotY;
        rotY = ny;
        rotX = Math.max(-0.25, Math.min(0.3, down.rx + (e.clientY - down.y) * 0.003));
        idle = 0;
    });
    const up = () => {
        down = null;
        canvas.classList.remove('drag');
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener(
        'wheel',
        (e) => {
            if (!e.ctrlKey) return; // plain wheel keeps scrolling the page
            e.preventDefault();
            targetDist = Math.max(D_MIN, Math.min(D_MAX, targetDist + e.deltaY * 0.01));
            kick();
        },
        { passive: false },
    );

    function applyLevels(): void {
        const f = FOCUS[current];
        organs.forEach((o, id) => {
            let want = o.min;
            if (id === 'bones' && layers.bones) want = 0.9;
            if (id === 'digestive' && layers.digestive) want = 0.9;
            if (id === 'vessels' && layers.vessels) want = current === 'heart' ? 0.95 : 0.5;
            if (f.mesh === id) want = 1;
            o.want = want;
        });
        skinU.uAlpha.value = layers.skin ? 1 : 0;
    }

    function select(id: RegionId): void {
        current = id;
        const f = FOCUS[id];
        marks.forEach((b, k) => b.classList.toggle('sel', k === id));
        const region = REGIONS.find((r) => r.id === id)!;
        tag.querySelector('span')!.textContent = region.name;
        applyLevels();
        organs.forEach((o) => (o.sweep.uAmt.value = 0));
        zoomed = true;
        targetDist = f.dist;
        targetY = nearest(f.angle);
        idle = 0;
        halo.visible = id === 'inner-ear';
        halo.position.copy(anchors.get(id)!);
        kick();
    }

    const size = { w: 300, h: 420 };
    function resize(): void {
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        if (!w || !h) return;
        size.w = w;
        size.h = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }

    function pulse(o: Organ, sx: number, sy: number, sz: number): void {
        o.pivot.scale.set(sx, sy, sz);
    }

    const wp = new Vector3();
    let raf = 0;
    let disposed = false;
    let last = 0;
    let clock = 0; // animation time, only advances while playing
    let slow = 0;
    let ratio = Math.min(devicePixelRatio, 2);
    function frame(t: number): void {
        raf = 0;
        if (disposed || document.hidden || !canvas.isConnected) return; // suspended; resumed by visibility/attach
        const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
        // slow device: lower the render resolution step by step
        if (last && t - last > 45) slow++;
        else slow = Math.max(0, slow - 1);
        if (slow > 24 && ratio > 0.75) {
            ratio = Math.max(0.75, ratio - 0.5);
            renderer.setPixelRatio(ratio);
            resize();
            slow = 0;
        }
        last = t;
        idle += dt * 1000;
        if (isPlaying) clock += dt;

        if (targetY !== null) {
            rotY += (targetY - rotY) * (reduced ? 1 : 0.1);
            if (Math.abs(targetY - rotY) < 0.002) {
                rotY = targetY;
                targetY = null;
            }
        } else if (!down && Math.abs(velY) > 0.0005) {
            rotY += velY;
            velY *= 0.92;
        } else if (!down && idle > 5000 && isPlaying) rotY += 0.0022;
        dist += (targetDist - dist) * (reduced ? 1 : 0.1);

        if (zoomed) lookT.copy(anchors.get(current)!).applyAxisAngle(new Vector3(0, 1, 0), rotY);
        else lookT.set(0, 0.9, 0);
        if (zoomed) {
            // keep the organ centred but do not swing the camera far off the turntable axis
            lookT.x *= 0.6;
            lookT.z *= 0.5;
        }
        look.lerp(lookT, reduced ? 1 : 0.09);
        const narrow = camera.aspect < 0.7 ? 1.15 : 1;
        const lift = zoomed ? 0.04 : 0.15;
        camera.position.set(look.x, look.y + lift + rotX * 1.4 * (dist / D_MAX), look.z + dist * narrow);
        camera.lookAt(look);
        body.rotation.y = rotY;
        if (isPlaying) dash.rotation.y += 0.0025;

        const night = document.documentElement.classList.contains('night');
        renderer.toneMappingExposure = night ? 0.7 : 0.95;
        skinU.uRim.value.set(night ? 0xd9925e : 0x3fb89a);
        skinU.uBase.value.set(night ? 0x6f6480 : 0x8fa39c);

        // visibility levels ease toward their targets
        organs.forEach((o) => {
            o.level += (o.want - o.level) * (reduced ? 1 : 0.12);
            const solid = o.level > 0.97;
            o.mat.opacity = solid ? 1 : o.level;
            if (o.mat.transparent === solid) {
                o.mat.transparent = !solid;
                o.mat.needsUpdate = true;
            }
            o.mat.depthWrite = o.level > 0.6;
            o.mesh.visible = o.level > 0.02;
        });

        // living body: the heart beats and the lungs breathe whenever motion is on
        const heart = organs.get('heart')!;
        const p = clock % 1;
        const beat = Math.exp(-(((p - 0.08) / 0.05) ** 2)) + 0.6 * Math.exp(-(((p - 0.3) / 0.06) ** 2));
        const hs = 1 - 0.065 * beat;
        pulse(heart, hs, hs, hs);
        const br = Math.sin((clock / 4.5) * Math.PI * 2);
        pulse(organs.get('lungs')!, 1 + 0.045 * br, 1 + 0.015 * br, 1 + 0.07 * br);
        const mus = organs.get('muscles')!;
        const contract = current === 'leg-muscles' ? 0.5 + 0.5 * Math.sin((clock / 2.2) * Math.PI * 2) : 0;
        pulse(mus, 1 + 0.035 * contract, 1 - 0.006 * contract, 1 + 0.035 * contract);

        // selected system: a light band sweeps through it
        const f = FOCUS[current];
        if (f.mesh) {
            const o = organs.get(f.mesh)!;
            const box = new Box3().setFromObject(o.mesh);
            const axis = o.sweep.uAxis.value.set(...f.sweep.axis).applyAxisAngle(new Vector3(0, 1, 0), rotY);
            // project the box on the axis: use the 8 corners for a tight range
            let lo = Infinity;
            let hi = -Infinity;
            for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
                const d = x * axis.x + y * axis.y + z * axis.z;
                lo = Math.min(lo, d);
                hi = Math.max(hi, d);
            }
            const k = (clock % f.sweep.period) / f.sweep.period;
            o.sweep.uWidth.value = Math.max(0.012, (hi - lo) * 0.09);
            o.sweep.uPos.value = lo - 0.05 + (hi - lo + 0.1) * k;
            o.sweep.uCol.value.set(f.sweep.color);
            o.sweep.uAmt.value = isPlaying ? f.sweep.amount * (f.mesh === 'heart' ? 0.4 + beat : 1) : 0;
        }
        if (halo.visible) {
            const s = 0.13 + 0.05 * Math.sin(clock * 3);
            halo.scale.set(s, s, 1);
        }
        // skin scan: one slow pass up the body, then a rest
        const sc = (clock % 7) / 7;
        skinU.uScanY.value = sc < 0.6 ? (sc / 0.6) * 1.75 : -1;
        skinU.uScanAmt.value = isPlaying && sc < 0.6 ? 0.7 : 0;

        renderer.render(scene, camera);

        // project markers and the tag
        marks.forEach((b, id) => {
            wp.copy(anchors.get(id)!);
            body.localToWorld(wp);
            wp.project(camera);
            const x = (wp.x * 0.5 + 0.5) * size.w;
            const y = (-wp.y * 0.5 + 0.5) * size.h;
            b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
            const off = wp.z > 1 || x < 0 || y < 0 || x > size.w || y > size.h;
            b.classList.toggle('back', off);
            if (id === current) {
                tag.style.transform = `translate(${(x + 16).toFixed(1)}px, ${y.toFixed(1)}px) translateY(-50%)`;
                tag.style.opacity = off ? '0' : '1';
            }
        });

        raf = requestAnimationFrame(frame);
    }
    function kick(): void {
        if (!raf && !disposed) {
            last = 0;
            raf = requestAnimationFrame(frame);
        }
    }
    const onVis = () => (document.hidden ? undefined : kick());
    document.addEventListener('visibilitychange', onVis);
    const ro = new ResizeObserver(() => {
        resize();
        kick();
    });
    ro.observe(stage);
    resize();
    select(current);
    zoomed = false; // start on the whole body; selecting a region zooms in
    targetDist = D_MAX;
    kick();

    return {
        select,
        play() {
            isPlaying = true;
            kick();
        },
        pause() {
            isPlaying = false;
        },
        playing: () => isPlaying,
        view(angle) {
            targetY = nearest(angle);
            idle = 0;
            kick();
        },
        zoom(delta) {
            targetDist = Math.max(D_MIN, Math.min(D_MAX, targetDist + delta));
            if (targetDist >= D_MAX - 0.05) zoomed = false;
            kick();
        },
        reset() {
            zoomed = false;
            targetDist = D_MAX;
            targetY = nearest(0.3);
            rotX = 0.04;
            kick();
        },
        layer(id, on) {
            layers[id] = on;
            applyLevels();
            kick();
        },
        attach(newHost) {
            newHost.prepend(stage);
            resize();
            kick();
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(raf);
            document.removeEventListener('visibilitychange', onVis);
            ro.disconnect();
            pm.dispose();
            renderer.dispose();
            stage.remove();
        },
    };
}
