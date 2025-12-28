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
        chunkSizeWarningLimit: 1000,
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
                        // Split by major components
                        if (id.includes('contrib/find') || id.includes('findController')) {
                            return 'monaco-find';
                        }
                        if (id.includes('contrib/folding') || id.includes('folding')) {
                            return 'monaco-folding';
                        }
                        if (id.includes('contrib/bracket') || id.includes('bracketMatching')) {
                            return 'monaco-bracket';
                        }
                        if (id.includes('contrib/comment') || id.includes('comment')) {
                            return 'monaco-comment';
                        }
                        if (id.includes('contrib/hover') || id.includes('hover')) {
                            return 'monaco-hover';
                        }
                        if (id.includes('contrib/suggest') || id.includes('suggest')) {
                            return 'monaco-suggest';
                        }
                        // Split remaining misc by size
                        if (id.includes('contrib')) {
                            return 'monaco-features';
                        }
                        // Split misc further
                        if (id.includes('services') || id.includes('standalone')) {
                            return 'monaco-services';
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
