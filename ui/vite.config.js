import { defineConfig } from 'vite'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

// Tauri configuration

export default defineConfig(({ mode: _mode }) => ({
    base: './', // Ensure relative paths for Tauri production
    plugins: [
        tailwindcss(),
    ],
    worker: {
        format: 'es',
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
    },
    // Fix for Tauri v2
    define: {
        'import.meta.env.TAURI_DEBUG': 'false',
    },
    build: {
        // Tauri uses Chromium on Windows and WebKit on macOS and Linux
        target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
        cssCodeSplit: false,
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                about: resolve(__dirname, 'about-dialog.html'),
                wizard: resolve(__dirname, 'wizard.html')
            },
            // Externalize Tauri imports
            external: [],
            output: {
                entryFileNames: 'assets/[name].js',
                // [Nihai Diyet]: Force every single monaco bit out of index.js

            }
        }
    }
}));
