/**
 * Detailed organ in 3D for the Body & Risks sheet.
 * Models: public/assets/models/organs/*.glb, extracted from the Z-Anatomy atlas (CC BY-SA 4.0,
 * derived from BodyParts3D) with Blender, one organ per file, simplified for offline use.
 * Loaded only when a region is opened; one viewer at a time, its canvas re-attached on re-render.
 */
import { ACESFilmicToneMapping, Box3, DirectionalLight, HemisphereLight, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface OrganView {
    src: string;
    renderer: WebGLRenderer;
    camera: PerspectiveCamera;
    controls: OrbitControls;
    scene: Scene;
    model: Object3D | null;
    raf: number;
    resize: ResizeObserver;
}

let current: OrganView | null = null;
const cache = new Map<string, Promise<Object3D>>();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function load(src: string): Promise<Object3D> {
    if (!cache.has(src)) cache.set(src, new GLTFLoader().loadAsync(src).then((g) => g.scene));
    return cache.get(src)!;
}

/**
 * Z-Anatomy colours its tissues in Blender's viewport, which glTF does not carry: the export keeps
 * the tissue name on each material (Bone, Tendon, Organ…). Give each tissue its usual atlas colour.
 */
const TISSUE: [RegExp, number][] = [
    [/text/i, -1],
    [/bone|ossicle|femur/i, 0xeee3cc],
    [/cartilage/i, 0xcfe3e6],
    [/tendon|ligament|fascia|retinacul/i, 0xe9dfc9],
    [/flexion|extension|abduct|adduct|rotat|muscle|trapezius|myocard/i, 0xb2483f],
    [/lung/i, 0xdf9a8f],
    [/white matter/i, 0xeee6dc],
    [/lcr|ventricle|csf/i, 0x8fd4cb],
    [/nucleus|grey|gray/i, 0xb07a63],
    [/lobe|cortex|gyrus|cerebell|brain/i, 0xe7b9ac],
    [/ductus|ureter|pelvis/i, 0xe3cf7c],
    [/organ|kidney/i, 0xa9463c],
    [/eye|sclera/i, 0xf3efe8],
    [/artery|aorta/i, 0xc23b32],
    [/vein|cava/i, 0x3f6fa8],
    [/nerve/i, 0xe8cf5a],
];

function paint(obj: Object3D): void {
    const hide: Object3D[] = [];
    obj.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        if (/\.t$/.test(o.name)) return void hide.push(o);
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[];
        for (const m of mats) {
            const c = m.color;
            const plain = !c || (c.r > 0.85 && c.g > 0.85 && c.b > 0.85);
            const rule = TISSUE.find(([re]) => re.test(m.name) || (plain && re.test(o.name)));
            if (rule?.[1] === -1) hide.push(o);
            else if (rule && plain) c.setHex(rule[1]);
            m.roughness = 0.62;
            m.metalness = 0;
        }
    });
    hide.forEach((h) => h.removeFromParent());
}

function frame(view: OrganView, obj: Object3D): void {
    const box = new Box3().setFromObject(obj);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    obj.position.sub(center);
    const r = Math.max(size.x, size.y, size.z) || 1;
    view.camera.near = r / 100;
    view.camera.far = r * 20;
    view.camera.position.set(0, r * 0.12, r * 2.3);
    view.camera.updateProjectionMatrix();
    view.controls.minDistance = r * 0.6;
    view.controls.maxDistance = r * 4;
    view.controls.target.set(0, 0, 0);
    view.controls.update();
}

function fit(view: OrganView, host: HTMLElement): void {
    const w = host.clientWidth || 320;
    const h = host.clientHeight || 260;
    view.renderer.setSize(w, h, false);
    view.camera.aspect = w / h;
    view.camera.updateProjectionMatrix();
}

/** Mounts (or re-attaches) the organ viewer in `host`. Returns false when WebGL is unavailable. */
export async function mountOrgan(host: HTMLElement, src: string): Promise<boolean> {
    if (current && current.src === src) {
        host.querySelector('.organ3d-canvas')?.remove();
        host.prepend(current.renderer.domElement);
        current.resize.disconnect();
        current.resize = new ResizeObserver(() => fit(current!, host));
        current.resize.observe(host);
        fit(current, host);
        host.dataset.state = 'on';
        return true;
    }
    disposeOrgan();
    let renderer: WebGLRenderer;
    try {
        renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
        return false;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.domElement.className = 'organ3d-canvas';
    const scene = new Scene();
    scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new HemisphereLight(0xffffff, 0xdcebe6, 0.9));
    const key = new DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 3, 4);
    scene.add(key);
    const camera = new PerspectiveCamera(35, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = !reduced();
    controls.autoRotateSpeed = 1.2;
    const view: OrganView = { src, renderer, camera, controls, scene, model: null, raf: 0, resize: new ResizeObserver(() => fit(view, host)) };
    current = view;
    host.prepend(renderer.domElement);
    view.resize.observe(host);
    fit(view, host);
    host.dataset.state = 'loading';
    // the user takes over: stop the slow turn after the first drag
    controls.addEventListener('start', () => (controls.autoRotate = false));
    let detached = 0;
    const tick = () => {
        // left the page: the canvas stays detached past a short re-render grace period, so stop
        if (!renderer.domElement.isConnected) {
            if (++detached > 60) return disposeOrgan();
        } else detached = 0;
        view.raf = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
    };
    tick();
    try {
        const obj = (await load(src)).clone(true);
        if (current !== view) return true;
        paint(obj);
        view.model = obj;
        scene.add(obj);
        frame(view, obj);
        host.dataset.state = 'on';
    } catch {
        host.dataset.state = 'failed';
    }
    return true;
}

export function disposeOrgan(): void {
    if (!current) return;
    cancelAnimationFrame(current.raf);
    current.resize.disconnect();
    current.controls.dispose();
    current.renderer.dispose();
    current.renderer.domElement.remove();
    current = null;
}
