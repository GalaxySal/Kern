import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Granular Monaco Imports (The Diet)
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/browser/coreCommands.js';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js';

// Core Languages Only (Pre-bundled)
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';

import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = { getWorker() { return new editorWorker(); } };

// DOM & State
const container = document.getElementById('editor-container');
const fileTreeEl = document.getElementById('file-tree');
const openDirBtn = document.getElementById('open-dir-btn');
const statusName = document.getElementById('file-name');
const statusLang = document.getElementById('status-lang');
const statusCursor = document.getElementById('status-cursor');

let currentFilePath = null;
let currentProjectRoot = null;

// Initialize Editor
const editor = monaco.editor.create(container, {
    value: '// Welcome to Kern\n// Click "Open Folder" to start.',
    language: 'javascript',
    theme: 'vs-dark',
    automaticLayout: true,
    fontFamily: "'Cascadia Code', monospace",
    fontSize: 13,
    minimap: { enabled: false }
});

editor.onDidChangeCursorPosition((e) => {
    statusCursor.innerText = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
});

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveFile());

// Core Actions
async function saveFile() {
    if (!currentFilePath) return;
    try {
        await invoke('save_file', { path: currentFilePath, content: editor.getValue() });
    } catch (e) { alert('Save failed: ' + e); }
}

async function openFile(path) {
    try {
        const content = await invoke('open_file', { path });
        const filename = path.split(/[\\/]/).pop();
        currentFilePath = path;
        updateEditor(content, path, filename);
        statusName.innerText = filename;
    } catch (e) { alert('Open failed: ' + e); }
}

async function updateEditor(content, path, filename) {
    editor.setValue(content);
    const ext = filename.split('.').pop().toLowerCase();
    const languageMap = { 'rs': 'rust', 'js': 'javascript', 'ts': 'typescript', 'html': 'html', 'css': 'css', 'py': 'python' };
    let lang = languageMap[ext] || 'plaintext';

    // [The Diet]: Dynamic Language Loading
    if (!['rust', 'javascript', 'typescript', 'plaintext'].includes(lang)) {
        try {
            await import(`monaco-editor/esm/vs/basic-languages/${lang}/${lang}.contribution`);
        } catch (e) { console.warn(`Lang ${lang} lazy-load failed.`); }
    }

    monaco.editor.setModelLanguage(editor.getModel(), lang);
    if (statusLang) statusLang.innerText = `{ } ${lang}`;
}

async function openDirectory() {
    try {
        const root = await invoke('open_project');
        currentProjectRoot = root.path;
        renderTree(root.children, fileTreeEl);
    } catch (e) { alert('Open folder failed: ' + e); }
}

function renderTree(entries, parentElement) {
    parentElement.innerHTML = '';
    entries.sort((a, b) => (b.is_dir - a.is_dir) || a.name.localeCompare(b.name)).forEach(entry => {
        const div = document.createElement('div');
        div.className = `flex items-center space-x-2 px-4 py-1 cursor-pointer hover:bg-[#2a2d2e] transition-colors text-xs ${entry.is_dir ? 'text-blue-300' : 'text-gray-300'}`;
        div.innerHTML = `<span>${entry.is_dir ? '📁' : '📄'}</span> <span>${entry.name}</span>`;
        if (!entry.is_dir) div.onclick = () => openFile(entry.path);
        else {
            let expanded = false;
            div.onclick = async () => {
                expanded = !expanded;
                if (expanded) {
                    const sub = document.createElement('div');
                    sub.className = 'pl-4';
                    div.after(sub);
                    const updated = await invoke('load_directory', { path: entry.path });
                    renderTree(updated, sub);
                } else div.nextElementSibling?.remove();
            };
        }
        parentElement.appendChild(div);
    });
}

openDirBtn.addEventListener('click', openDirectory);

// Terminal
const termContainer = document.getElementById('panel-content-terminal');
async function initTerminal() {
    const term = new Terminal({ theme: { background: '#1e1e1e' }, fontSize: 12 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termContainer);
    fitAddon.fit();
    await listen('terminal-stdout', (e) => term.write(e.payload));
    term.onData(data => invoke('write_term', { data }));
    await invoke('spawn_term');
    window.addEventListener('resize', () => fitAddon.fit());
}
initTerminal();

// Bootstrap Lazy Modules
async function bootstrap() {
    const vibe = await import('./vibe.js');
    const settings = await import('./settings.js');

    const appState = {
        editor,
        get currentFilePath() { return currentFilePath; },
        get currentProjectRoot() { return currentProjectRoot; },
        openFile,
        elements: {
            vibePanel: document.getElementById('vibe-panel'),
            vibeInput: document.getElementById('vibe-input'),
            vibeSendBtn: document.getElementById('vibe-send-btn'),
            vibeChatHistory: document.getElementById('vibe-chat-history'),
            modelSelect: document.getElementById('vibe-model-select'),
            customModelIdInput: document.getElementById('vibe-custom-model-id'),
            customModelContainer: document.getElementById('vibe-custom-model-container'),
            settingsView: document.getElementById('vibe-settings-view'),
            settingsBtn: document.getElementById('vibe-settings-btn'),
            vibeSaveBtn: document.getElementById('vibe-save-btn'),
            vibeToggleBtn: document.getElementById('vibe-toggle-btn'),
            closeVibeBtn: document.getElementById('vibe-close-btn')
        }
    };

    vibe.initVibe(appState);
    settings.initSettings(appState);
}
bootstrap();
