import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.ts'],
    },
    resolve: {
        alias: {
            '@core': path.resolve(__dirname, 'src/core/'),
            '@chromium': path.resolve(__dirname, 'src/chromium/'),
            '@firefox': path.resolve(__dirname, 'src/firefox/'),
        },
    },
});
