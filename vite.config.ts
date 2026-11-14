import { defineConfig, type Plugin } from 'vite';
import laravel from 'laravel-vite-plugin';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Writes public/sw.js after each production build.
 * Precache list = the app shell ("/") + every emitted asset except the lazy 3D chunks
 * + the static files the 2D views need. The cache name is derived from the list, so a new
 * build creates a new cache while IndexedDB (observations, reports) is never touched.
 */
function quintaServiceWorker(): Plugin {
    return {
        name: 'quinta-service-worker',
        apply: 'build',
        closeBundle() {
            const statics = [
                '/',
                '/manifest.webmanifest',
                '/assets/brand/hexta-logo.svg',
                '/assets/brand/hexta-symbole.svg',
                '/assets/brand/favicon-32.png',
                '/assets/brand/hexta-icone-app-180.png',
                '/assets/illustrations/body-front.webp',
                '/assets/illustrations/lunar-window.webp',
            ];
            // Read what was really written (Vite manifest), skipping dynamic-only chunks (3D viewer).
            type Chunk = { file: string; css?: string[]; assets?: string[]; isDynamicEntry?: boolean };
            const manifest = JSON.parse(readFileSync('public/build/manifest.json', 'utf8')) as Record<string, Chunk>;
            const files = new Set<string>();
            for (const chunk of Object.values(manifest)) {
                if (chunk.isDynamicEntry || /(three|body3d|GLTFLoader)/i.test(chunk.file)) continue;
                [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])].forEach((f) => files.add(`/build/${f}`));
            }
            const precache = [...statics, ...[...files].sort()];
            const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
            const template = readFileSync('resources/sw/sw.template.js', 'utf8');
            writeFileSync(
                'public/sw.js',
                template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 2)),
            );
        },
    };
}

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/main.ts'],
            refresh: true,
        }),
        quintaServiceWorker(),
    ],
    build: { chunkSizeWarningLimit: 800 },
    server: {
        watch: { ignored: ['**/storage/framework/views/**'] },
    },
});
