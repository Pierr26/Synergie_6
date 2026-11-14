/**
 * Mockup preview formats (Adaptive · Desktop · Tablet · Phone), as in reference/QUINTA-lot4.
 * A device format shows the app inside a framed iframe of the device size, so every breakpoint
 * behaves exactly as on the real device. The page inside the frame hides the preview bar.
 */
import { writePref } from './state';

export type PreviewFormat = 'auto' | 'desk' | 'tab' | 'mob';
const SIZES: Record<Exclude<PreviewFormat, 'auto'>, [number, number]> = { desk: [1280, 800], tab: [834, 1000], mob: [390, 800] };
const LABEL: Record<PreviewFormat, string> = { auto: 'Adaptive', desk: 'Desktop', tab: 'Tablet', mob: 'Phone' };

export const IN_FRAME = (() => {
    try {
        return window.self !== window.top;
    } catch {
        return true;
    }
})();

export function previewFormat(): PreviewFormat {
    if (IN_FRAME) return 'auto';
    try {
        const v = localStorage.getItem('quinta.pv');
        return v === 'desk' || v === 'tab' || v === 'mob' ? v : 'auto';
    } catch {
        return 'auto';
    }
}

export function formatButtons(current = previewFormat()): string {
    return (Object.keys(LABEL) as PreviewFormat[])
        .map((f) => `<button type="button" data-action="pv-format" data-pv="${f}" aria-pressed="${f === current}">${LABEL[f]}</button>`)
        .join('');
}

const ROLE_HOME: Record<string, [string, string]> = { astronaut: ['Astronaut', '/overview'], cmo: ['CMO', '/crew'], ground: ['Houston', '/ground'] };

function roleButtons(): string {
    let role = 'astronaut';
    try {
        role = localStorage.getItem('quinta.role') ?? 'astronaut';
    } catch {
        /* preference only */
    }
    return Object.entries(ROLE_HOME)
        .map(([r, [label]]) => `<button type="button" data-pv-role="${r}" aria-pressed="${r === role}">${label}</button>`)
        .join('');
}

/** Shows or removes the device stage. Returns true when a device format is active (the normal shell stays hidden). */
export function applyPreview(root: HTMLElement): boolean {
    const f = previewFormat();
    let stage = document.getElementById('pv-stage');
    if (f === 'auto') {
        stage?.remove();
        root.hidden = false;
        document.documentElement.classList.remove('pv-device');
        return false;
    }
    const [w, h] = SIZES[f];
    root.hidden = true;
    document.documentElement.classList.add('pv-device');
    if (!stage) {
        stage = document.createElement('div');
        stage.id = 'pv-stage';
        stage.innerHTML = `<div class="preview pv-stage-bar"><span class="pv-line"><strong>QUINTA</strong> · preview format</span><div class="pv-btns" role="group" aria-label="Role">${roleButtons()}</div><div class="pv-btns" role="group" aria-label="Preview format">${formatButtons(f)}</div></div><div class="pv-frame-wrap"><iframe class="pv-frame" title="QUINTA preview"></iframe></div>`;
        document.body.appendChild(stage);
        stage.addEventListener('click', (e) => {
            const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pv-role]');
            if (!b) return;
            const r = b.dataset.pvRole!;
            writePref('quinta.role', r);
            stage!.querySelectorAll('[data-pv-role]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            (stage!.querySelector('iframe') as HTMLIFrameElement).src = ROLE_HOME[r][1];
        });
        (stage.querySelector('iframe') as HTMLIFrameElement).src = location.pathname + location.search;
    }
    stage.querySelectorAll('[data-pv]').forEach((x) => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.pv === f)));
    const frame = stage.querySelector('iframe') as HTMLIFrameElement;
    frame.style.setProperty('--w', `${w}px`);
    frame.style.setProperty('--h', `${h}px`);
    frame.classList.toggle('phone', f === 'mob');
    return true;
}

export function setPreviewFormat(f: PreviewFormat): void {
    writePref('quinta.pv', f === 'auto' ? null : f);
}
