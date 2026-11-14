import { WORKSPACES } from './demo/config';
import type { Role, WorkspaceConfig, WorkspaceId } from './domain/types';

export interface Route {
    path: string;
    segments: string[];
    query: URLSearchParams;
}

export interface AppState {
    ws: WorkspaceId | null;
    role: Role;
    now: number;
    route: Route;
    groundLink: boolean;
    loseNextReceipt: boolean;
    browserOnline: boolean;
    offlineReady: boolean;
    unread: number;
    /** Preview display chosen in the preview bar: the app itself, or the app inside a device frame. */
    viewport: Viewport;
    /** Desktop sidebar folded to the icon rail by the logo button. */
    rail: boolean;
}

export type Viewport = 'auto' | 'desktop' | 'tablet' | 'mobile';

/** Device sizes of the preview frame, as in the HEXTA mockup (width × height). */
export const VIEWPORT_SIZE: Record<Exclude<Viewport, 'auto'>, [number, number]> = {
    desktop: [1280, 800],
    tablet: [834, 1000],
    mobile: [390, 800],
};

/** True when this document runs inside the preview device frame. */
export const EMBEDDED = typeof window !== 'undefined' && window.self !== window.top;

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T | null): T | null {
    try {
        const v = localStorage.getItem(key) as T | null;
        return v && allowed.includes(v) ? v : fallback;
    } catch {
        return fallback;
    }
}

export function writePref(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        /* preferences are a convenience only */
    }
}

export const app: AppState = {
    ws: readPref<WorkspaceId>('quinta.ws', ['demo', 'explore'], null),
    role: readPref<Role>('quinta.role', ['astronaut', 'cmo', 'ground'], 'astronaut') ?? 'astronaut',
    now: Date.now(),
    route: { path: '/', segments: [], query: new URLSearchParams() },
    groundLink: false,
    loseNextReceipt: false,
    browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    offlineReady: false,
    unread: 0,
    viewport: readPref<Viewport>('hexta.viewport', ['auto', 'desktop', 'tablet', 'mobile'], 'auto') ?? 'auto',
    rail: readPref<'1' | '0'>('hexta.rail', ['1', '0'], '0') === '1',
};

/** Re-reads the preferences another document (preview bar or device frame) may have changed. */
export function syncPrefs(): void {
    app.role = readPref<Role>('quinta.role', ['astronaut', 'cmo', 'ground'], app.role) ?? app.role;
    app.rail = readPref<'1' | '0'>('hexta.rail', ['1', '0'], '0') === '1';
}

export function cfg(): WorkspaceConfig {
    return WORKSPACES[app.ws ?? 'demo'];
}

export function ws(): WorkspaceId {
    return app.ws ?? 'demo';
}

/** identity of the current role in the current workspace */
export function me(): string {
    const c = cfg();
    return app.role === 'cmo' ? c.cmoId : app.role === 'ground' ? c.groundId : c.astronautId;
}

/** each role's home screen */
export function homeFor(role: Role = app.role): string {
    return role === 'cmo' ? '/crew' : role === 'ground' ? '/ground' : '/overview';
}
