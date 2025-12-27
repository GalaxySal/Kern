import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
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
    build: {
        cssCodeSplit: false,
        rollupOptions: {
            output: {
                // [Nihai Diyet]: Force every single monaco bit out of index.js
                manualChunks: (id) => {
                    if (id.includes('monaco-editor')) {
                        return 'monaco-vendor';
                    }
                    if (id.includes('node_modules')) {
                        return 'vendor'; // xterm, etc
                    }
                }
            }
        }
    }
})
