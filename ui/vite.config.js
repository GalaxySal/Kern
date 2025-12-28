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
                        // Split features into smaller groups
                        if (id.includes('contrib/find')) {
                            return 'monaco-find';
                        }
                        if (id.includes('contrib/folding')) {
                            return 'monaco-folding';
                        }
                        if (id.includes('contrib/bracket')) {
                            return 'monaco-bracket';
                        }
                        if (id.includes('contrib/comment')) {
                            return 'monaco-comment';
                        }
                        if (id.includes('contrib/hover')) {
                            return 'monaco-hover';
                        }
                        if (id.includes('contrib/suggest')) {
                            return 'monaco-suggest';
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
