/**
 * Registers /sw.js (production build only) and reports "Ready offline" once the precache
 * of the current version is complete. Cache state is separate from the browser network state
 * and from the simulated ground link.
 */
export function registerServiceWorker(onStatus: (ready: boolean) => void): void {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    const ask = () => navigator.serviceWorker.controller?.postMessage({ type: 'status' });
    navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'status') onStatus(Boolean(e.data.ready));
    });
    navigator.serviceWorker.addEventListener('controllerchange', ask);
    navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
            const poll = () => (navigator.serviceWorker.controller ? ask() : undefined);
            if (reg.active) poll();
            reg.addEventListener('updatefound', () => {
                reg.installing?.addEventListener('statechange', (ev) => {
                    if ((ev.target as ServiceWorker).state === 'activated') ask();
                });
            });
            window.setTimeout(poll, 1500);
            window.setInterval(poll, 20000);
        })
        .catch(() => onStatus(false));
}
