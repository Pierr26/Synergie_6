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
}

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
    role: readPref<Role>('quinta.role', ['astronaut', 'cmo'], 'astronaut') ?? 'astronaut',
    now: Date.now(),
    route: { path: '/', segments: [], query: new URLSearchParams() },
    groundLink: false,
    loseNextReceipt: false,
    browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    offlineReady: false,
    unread: 0,
};

export function cfg(): WorkspaceConfig {
    return WORKSPACES[app.ws ?? 'demo'];
}

export function ws(): WorkspaceId {
    return app.ws ?? 'demo';
}

/** identity of the current role in the current workspace */
export function me(): string {
    const c = cfg();
    return app.role === 'cmo' ? c.cmoId : c.astronautId;
}
