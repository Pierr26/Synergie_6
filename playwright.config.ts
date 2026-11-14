import { defineConfig } from '@playwright/test';

/** Runs against the production build served by Laravel (same origin), e.g. `php artisan serve`. */
export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: process.env.QUINTA_URL ?? 'http://127.0.0.1:8000',
        serviceWorkers: 'allow',
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    },
    projects: [
        { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
        { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    ],
});
