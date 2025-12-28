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
                    // Split Monaco into smaller chunks
                    if (id.includes('monaco-editor')) {
                        if (id.includes('editor/editor.api')) {
                            return 'monaco-core';
                        }
                        if (id.includes('basic-languages')) {
                            return 'monaco-languages';
                        }
                        if (id.includes('contrib')) {
                            return 'monaco-features';
                        }
                        return 'monaco-misc';
                    }
                    if (id.includes('node_modules')) {
                        return 'vendor'; // xterm, etc
                    }
                }
            }
        }
    }
})
