import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { pageHead, simTag, toast } from '../../components/ui';
import * as repo from '../../data/repo';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, me, writePref, ws } from '../../state';
import { HAZARDS, REGIONS, regionById, SOURCES, type RegionId } from './content';

let viewer: import('./body3d').Viewer | null = null;
let viewerState: 'off' | 'loading' | 'on' | 'failed' = 'off';
let failReason = '';
/** 3D opens by default where WebGL exists; "Back to 2D" turns it off and is remembered. */
const AUTO_3D = true;
let viewAngle = 0.3;
let shownRegion: string | null = null;
const layerOn: Record<import('./body3d').LayerId, boolean> = { skin: true, vessels: true, bones: false, digestive: false };
let sex: import('./body3d').Sex = (() => {
    try {
        return localStorage.getItem('quinta.body') === 'male' ? 'male' : 'female';
    } catch {
        return 'female';
    }
})();

function wants3d(): boolean {
    try {
        return localStorage.getItem('quinta.body3d') !== 'off';
    } catch {
        return true;
    }
}

function hasWebGL(): boolean {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
        return false;
    }
}

function currentRegion(): RegionId {
    return regionById(app.route.query.get('region')).id;
}

async function start3d(): Promise<void> {
    if (viewerState === 'loading') return;
    const host = document.getElementById('viewer3d');
    if (!host) return;
    if (!hasWebGL()) {
        viewerState = 'failed';
        failReason = 'WebGL is not available on this device. The body map and every risk sheet stay fully usable in 2D.';
        await bus.refresh();
        return;
    }
    viewerState = 'loading';
    await bus.refresh();
    try {
        const mod = await import('./body3d');
        const h = document.getElementById('viewer3d')!;
        viewer = await mod.createViewer(h, {
            initial: currentRegion(),
            sex,
            onSelect: (id) => bus.navigate(`/body?region=${id}`),
            onProgress: (r) => {
                const bar = document.getElementById('loadBar');
                if (bar) bar.style.width = `${Math.round(30 + r * 70)}%`;
            },
        });
        (Object.keys(layerOn) as (keyof typeof layerOn)[]).forEach((k) => viewer!.layer(k, layerOn[k]));
        viewerState = 'on';
        await bus.refresh();
        const status = document.getElementById('v3d-status');
        if (status) status.textContent = '3D anatomy loaded. Drag to rotate, select a point or use the region list.';
    } catch (e) {
        viewerState = 'failed';
        failReason = `The 3D model could not load (${e instanceof Error ? e.message : 'unknown error'}). The 2D body map stays fully usable.`;
        viewer = null;
        await bus.refresh();
    }
}

function updateHeartControls(): void {
    const btn = document.getElementById('heart-play');
    if (btn && viewer) btn.innerHTML = `${icon(viewer.playing() ? 'pause' : 'play').value}${viewer.playing() ? 'Pause animation' : 'Play animation'}`;
}

function press(group: string, match: (b: HTMLElement) => boolean): void {
    document.querySelectorAll<HTMLElement>(group).forEach((b) => b.setAttribute('aria-pressed', String(match(b))));
}

registerActions({
    'body-3d': async () => {
        writePref('quinta.body3d', null);
        await start3d();
    },
    'body-3d-close': async () => {
        viewer?.dispose();
        viewer = null;
        shownRegion = null;
        viewerState = 'off';
        writePref('quinta.body3d', 'off');
        await bus.refresh();
    },
    'v3d-angle': (el) => {
        viewAngle = Number(el.dataset.angle);
        viewer?.view(viewAngle);
        press('.v-views [data-angle]', (b) => b === el);
    },
    'v3d-zoom': (el) => viewer?.zoom(Number(el.dataset.d)),
    'v3d-reset': () => {
        viewAngle = 0.3;
        viewer?.reset();
        press('.v-views [data-angle]', (b) => b.dataset.angle === '0.3');
    },
    'v3d-sex': async (el) => {
        const next = el.dataset.sex as typeof sex;
        if (next === sex) return;
        sex = next;
        writePref('quinta.body', sex);
        viewer?.dispose();
        viewer = null;
        shownRegion = null;
        viewerState = 'off';
        await start3d();
    },
    'v3d-layer': (el) => {
        const id = el.dataset.layer as keyof typeof layerOn;
        layerOn[id] = !layerOn[id];
        viewer?.layer(id, layerOn[id]);
        el.setAttribute('aria-pressed', String(layerOn[id]));
    },
    'heart-play': async () => {
        if (!viewer) {
            await start3d();
        } else if (viewer.playing()) viewer.pause();
        else viewer.play();
        updateHeartControls();
    },
    'body-review': async (el) => {
        const name = el.dataset.name!;
        await repo.requestReview(ws(), me(), `Question about ${name.toLowerCase()} (from Body & Risks).`, [], app.now);
        toast('Crew review requested. Your CMO was notified on board.');
        await bus.refresh();
    },
    'mount:body': (el) => {
        // the viewer owns its canvas; re-attach it to the freshly rendered host
        if (viewer && viewerState === 'on') {
            const host = el.querySelector('#viewer3d') as HTMLElement | null;
            if (host) viewer.attach(host);
            const wanted = app.route.query.get('region');
            if (wanted && wanted !== shownRegion) {
                shownRegion = wanted;
                viewer.select(currentRegion());
            }
            updateHeartControls();
        } else if (AUTO_3D && viewerState === 'off' && wants3d()) {
            // 3D opens by default where WebGL exists; the 2D map and the list stay the fallback
            if (hasWebGL()) void start3d();
            else {
                viewerState = 'failed';
                failReason = 'WebGL is not available on this device. The body map and every risk sheet stay fully usable in 2D.';
                void bus.refresh();
            }
        }
    },
});

/** keyboard: arrow keys move between region buttons (roving focus inside the list) */
document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (!t.matches('.region-list a')) return;
    const items = [...document.querySelectorAll<HTMLAnchorElement>('.region-list a')];
    const i = items.indexOf(t as HTMLAnchorElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        items[(i + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length].focus();
    }
});

export async function renderBody(): Promise<Html> {
    const region = regionById(app.route.query.get('region'));
    const isHeart = region.id === 'heart';
    const on = viewerState === 'on';
    const v3d =
        viewerState === 'off'
            ? html`<button type="button" class="btn btn-ghost" data-action="body-3d">${icon('cube')}View in 3D</button><span class="hint">Loads a 1.4 MB anatomy model on demand.</span>`
            : viewerState === 'loading'
              ? html`<span class="badge badge-info">${icon('cube')}Loading 3D anatomy…</span>`
              : viewerState === 'failed'
                ? html`<p class="notice">${icon('info')}${failReason}</p>`
                : html`<button type="button" class="btn btn-ghost btn-small" id="heart-play" data-action="heart-play">${icon('pause')}Pause animation</button>
                    <div class="v-layers" role="group" aria-label="Layers">${(['skin', 'vessels', 'bones', 'digestive'] as const).map((l) => html`<button type="button" data-action="v3d-layer" data-layer="${l}" aria-pressed="${layerOn[l]}">${{ skin: 'Skin', vessels: 'Vessels', bones: 'Skeleton', digestive: 'Digestive' }[l]}</button>`)}</div>
                    <button type="button" class="btn btn-quiet btn-small" data-action="body-3d-close">${icon('close')}Back to 2D</button>`;
    const angles: [number, string][] = [[0.3, 'Front'], [1.5708, 'Side'], [3.1416, 'Back']];
    return html`
    ${pageHead('Body & Risks', 'Choose a body region to see why it matters in space, what QUINTA records, and what you can do. Sources are NASA Human Research Program pages.', simTag('Educational content'))}
    <div class="body-layout" data-mount="body">
      <section class="card body-map" aria-labelledby="map-h">
        <h2 id="map-h" class="sr-only">Body regions</h2>
        <div class="figure-wrap viewer">
          <div class="figure2d ${viewerState === 'on' ? 'is-hidden' : ''}">
            <img src="/assets/illustrations/body-front.webp" alt="" width="640" height="900">
            ${REGIONS.map((r) => html`<a class="marker ${r.id === region.id ? 'on' : ''}" href="/body?region=${r.id}" data-link style="left:${r.x}%;top:${r.y}%" tabindex="-1" aria-hidden="true" title="${r.name}"><span>${r.name}</span></a>`)}
          </div>
          <div id="viewer3d" class="viewer3d" data-state="${viewerState}" ${on || viewerState === 'loading' ? '' : 'hidden'}>
            <p id="v3d-status" class="sr-only" role="status"></p>
            ${on ? html`<div class="v-views" role="group" aria-label="View angle">${angles.map(([v, l]) => html`<button type="button" data-action="v3d-angle" data-angle="${v}" aria-pressed="${Math.abs(viewAngle - v) < 0.01}">${l}</button>`)}</div>
            <div class="v-views v-sex" role="group" aria-label="Body model">${(['female', 'male'] as const).map((s) => html`<button type="button" data-action="v3d-sex" data-sex="${s}" aria-pressed="${sex === s}">${s === 'female' ? 'Female' : 'Male'}</button>`)}</div>
            <div class="v-tools">
              <button type="button" data-action="v3d-zoom" data-d="-0.6" aria-label="Zoom in">${icon('plus')}</button>
              <button type="button" data-action="v3d-zoom" data-d="0.6" aria-label="Zoom out">${icon('minus')}</button>
              <button type="button" data-action="v3d-reset" aria-label="Reset view">${icon('retry')}</button>
            </div>
            <div class="v-hint">${icon('retry', 'sm')}Select a point to zoom · drag to rotate</div>` : ''}
            ${viewerState === 'loading' ? html`<div class="loading3d"><span>Loading 3D anatomy…</span><span class="bar"><i id="loadBar" style="width:30%"></i></span></div>` : ''}
          </div>
        </div>
        <div class="v3d-bar">${v3d}</div>
        <p class="fine v3d-credit">3D anatomy: <a href="https://humanatlas.io/3d-reference-library" target="_blank" rel="noopener">HuBMAP Human Reference Atlas</a> reference bodies (Visible Human, Allen brain), CC BY 4.0, simplified for QUINTA. Motion is an illustration.</p>
        <ul class="region-list organ-chips" aria-label="Body regions">
          ${REGIONS.map((r) => html`<li><a href="/body?region=${r.id}" data-link class="${r.id === region.id ? 'active' : ''}" ${r.id === region.id ? html`aria-current="true"` : ''}><b>${r.name}</b><small>${r.system}</small></a></li>`)}
        </ul>
      </section>

      <article class="card risk-sheet" aria-labelledby="sheet-h" id="sheet">
        <div class="organ-h"><div><h2 id="sheet-h">${region.name}</h2><span class="sys">${region.system} · ${region.hazards.map((h) => HAZARDS.find((x) => x.id === h)!.name).join(' · ')}</span></div></div>
        <h3>Why this matters</h3>
        <p>${region.why}</p>
        <h3>What QUINTA records</h3>
        <ul class="measure-links">${region.measure.map((m) => html`<li><a href="${m.href}" data-link>${m.label} ${icon('arrow')}</a></li>`)}</ul>
        <div class="note"><b>How to read it</b>${region.read}</div>
        <h3>What you can do</h3>
        <p>${region.action}</p>
        ${on || isHeart ? html`<p class="hint anim-note">${icon('info')}Illustration only: the 3D motion is a fixed loop, independent of any crew member’s measurements.</p>` : ''}
        <div class="row-actions">
          ${app.role === 'astronaut' ? html`<button type="button" class="btn btn-primary" data-action="body-review" data-name="${region.name}">${icon('send')}Request crew review</button>` : ''}
        </div>
        <h3>Sources</h3>
        <ul class="sources">${region.sources.map((s) => html`<li><a href="${SOURCES[s].url}" target="_blank" rel="noopener">${SOURCES[s].title}</a> · ${SOURCES[s].org}</li>`)}</ul>
      </article>
    </div>

    <section class="card" aria-labelledby="hz-h">
      <h2 id="hz-h">The five hazards of human spaceflight</h2>
      <p class="hint">NASA HRP groups spaceflight risks into five hazards. <a href="${SOURCES.S01.url}" target="_blank" rel="noopener">NASA Human Research Program</a></p>
      <ul class="hazards">${HAZARDS.map((h) => html`<li><b>${h.name}</b><p>${h.summary}</p><small>In QUINTA: ${h.link}</small></li>`)}</ul>
    </section>`;
}
