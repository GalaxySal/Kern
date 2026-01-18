import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Import i18n
import { initI18n, t } from './src/i18n.js';
import './src/language-switcher.js';

import { open } from '@tauri-apps/plugin-dialog';
// import { showAboutDialog } from './src/about.js';
import { GitPanel } from './git-panel.js';

// Import Simple LSP Client
import SimpleLSPClient from './src/lsp/SimpleLSPClient.js';

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
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline';

// Make Terminal and FitAddon available globally for split terminal
window.Terminal = Terminal;
window.FitAddon = FitAddon;

self.MonacoEnvironment = {
    getWorker(_moduleId, _label) {
        try {
            return new editorWorker();
        } catch (e) {
            console.error('[Monaco] Failed to create worker:', e);
            throw e;
        }
    }
};

// DOM & State
const container = document.getElementById('editor-container');
const fileTreeEl = document.getElementById('file-tree');
const openDirBtn = document.getElementById('open-dir-btn');
const statusName = document.getElementById('file-name');
const statusLang = document.getElementById('status-lang');
const statusCursor = document.getElementById('status-cursor');

let currentFilePath = null;
let currentProjectRoot = null;

// Initialize Simple LSP Client
const lspClient = new SimpleLSPClient();

// Initialize i18n
let i18nReady = false;

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

// Initialize i18n and update UI
async function initializeApp() {
    try {
        const locale = await initI18n();
        i18nReady = true;
        console.log(`i18n initialized with locale: ${locale}`);
        updateUITranslations();
    } catch (error) {
        console.error('Failed to initialize i18n:', error);
    }
}

// Update UI elements with translations
function updateUITranslations() {
    if (!i18nReady) return;
    
    // Update menu items
    const menuItems = {
        'menu-file': t('menu.file'),
        'menu-edit': t('menu.edit'),
        'menu-view': t('menu.view'),
        'menu-terminal': t('menu.terminal'),
        'menu-help': t('menu.help'),
        'action-new-file': t('menu.new_file'),
        'action-open-file': t('menu.open_file'),
        'action-save-file': t('menu.save_file'),
        'action-open-folder': t('menu.open_folder'),
        'action-exit': t('menu.exit'),
        'action-undo': t('menu.undo'),
        'action-redo': t('menu.redo'),
        'action-cut': t('menu.cut'),
        'action-copy': t('menu.copy'),
        'action-paste': t('menu.paste'),
        'action-find': t('menu.find'),
        'action-select-all': t('menu.select_all'),
        'action-toggle-sidebar': t('menu.toggle_sidebar'),
        'action-toggle-panel': t('menu.toggle_panel'),
        'action-new-terminal': t('terminal.new_terminal'),
        'action-split-terminal': t('terminal.split_terminal'),
        'action-welcome': t('help.welcome'),
        'action-about': t('help.about')
    };
    
    Object.entries(menuItems).forEach(([id, text]) => {
        const element = document.getElementById(id);
        if (element) {
            if (element.tagName === 'INPUT' && element.type === 'button') {
                element.value = text;
            } else {
                element.textContent = text;
            }
        }
    });
    
    // Update window title
    document.title = t('app.name');
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

editor.onDidChangeCursorPosition((e) => {
    statusCursor.innerText = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
});

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveFile());

// Git Branch Management
let gitPanel = null;

async function updateGitBranch() {
    const branchElement = document.getElementById('git-branch');
    if (!currentProjectRoot) {
        if (branchElement) {
            branchElement.textContent = '';
            branchElement.className = '';
        }
        return;
    }

    try {
        const status = await invoke('git_status', { repoPath: currentProjectRoot });
        if (branchElement) {
            const branchName = status.branch || '';
            const dirtyIndicator = status.is_dirty ? '*' : '';
            branchElement.textContent = status.branch ? `${status.branch}${dirtyIndicator}` : '';
            branchElement.className = status.branch ? 'text-white' : 'text-gray-400 opacity-70';

            // Update document title with branch name if in a git repo
            if (status.branch && currentFilePath) {
                const fileName = currentFilePath.split('/').pop();
                document.title = `${fileName} (${status.branch}${dirtyIndicator}) - Kern Editor`;
            }
        }

        // Initialize Git panel if not already done
        if (!gitPanel) {
            gitPanel = new GitPanel();
            gitPanel.setPath(currentProjectRoot);
            setupGitMenu();
        }
    } catch (e) {
        // Not a git repo or error
        if (branchElement) {
            branchElement.textContent = '';
            branchElement.className = '';
        }
    }
}

// Setup Git menu
function setupGitMenu() {
    // Add Git menu item if it doesn't exist
    if (!document.getElementById('menu-git')) {
        const menuBar = document.getElementById('menubar');
        const terminalMenu = document.querySelector('[data-menu="terminal"]').parentElement;

        const gitMenu = document.createElement('div');
        gitMenu.className = 'relative menu-container h-full';
        gitMenu.id = 'menu-git';
        gitMenu.innerHTML = `
            <div class="menu-btn px-3 h-full flex items-center hover:bg-[#3c3c3c] cursor-pointer rounded-sm" data-menu="git">
                Git
            </div>
            <ul id="dropdown-git" class="menu-dropdown hidden absolute top-full left-0 w-64 bg-[#252526] border border-[#454545] shadow-xl py-1 z-50 text-[#cccccc]">
                <li class="px-4 py-1.5 hover:bg-[#094771] hover:text-white cursor-pointer flex justify-between group" id="git-commit">
                    <span>Commit</span>
                    <span class="text-xs text-gray-500 group-hover:text-white">Ctrl+Enter</span>
                </li>
                <li class="px-4 py-1.5 hover:bg-[#094771] hover:text-white cursor-pointer" id="git-pull">
                    Pull
                </li>
                <li class="px-4 py-1.5 hover:bg-[#094771] hover:text-white cursor-pointer" id="git-push">
                    Push
                </li>
                <li class="px-4 py-1.5 hover:bg-[#094771] hover:text-white cursor-pointer" id="git-branches">
                    Branches...
                </li>
            </ul>
        `;

        menuBar.insertBefore(gitMenu, terminalMenu.nextSibling);

        // Add event listeners for Git menu items
        document.getElementById('git-commit')?.addEventListener('click', () => {
            const commitMessage = prompt('Enter commit message:');
            if (commitMessage) {
                invoke('git_commit', {
                    repoPath: currentProjectRoot,
                    message: commitMessage
                }).then(() => {
                    updateGitBranch();
                    gitPanel?.refresh();
                }).catch(console.error);
            }
        });

        document.getElementById('git-pull')?.addEventListener('click', () => {
            gitPanel?.pull();
        });

        document.getElementById('git-push')?.addEventListener('click', () => {
            gitPanel?.push();
        });

        document.getElementById('git-branches')?.addEventListener('click', () => {
            // Focus the branch dropdown in the Git panel
            const branchSelect = document.querySelector('#git-branch-select');
            if (branchSelect) {
                branchSelect.focus();
                branchSelect.click(); // Open dropdown
            }
        });

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                const activeElement = document.activeElement;
                if (activeElement && activeElement.id === 'git-commit-message') {
                    gitPanel?.commit();
                    e.preventDefault();
                }
            }
        });
    }
}

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
        if (statusName) {
            statusName.innerText = filename;
        }
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
            await import(/* @vite-ignore */ `monaco-editor/esm/vs/basic-languages/${lang}/${lang}.contribution`);
        } catch { console.warn(`Lang ${lang} lazy-load failed.`); }
    }

    monaco.editor.setModelLanguage(editor.getModel(), lang);
    if (statusLang) statusLang.innerText = `{ } ${lang}`;

    // Start LSP support for this file
    if (currentProjectRoot) {
        await lspClient.startLanguageServer(path, editor);
        updateLSPStatus(lang, true);
    }
}

async function openProjectDialog() {
    try {
        const useFileMethod = navigator.userAgent.includes('Linux') || navigator.userAgent.includes('Windows');

        if (useFileMethod) {
            // File-based approach (fallback)
            const selectedFile = await open({
                multiple: false,
                defaultPath: await invoke('get_home_dir'),
                title: 'Select a file in the project folder'
            });

            if (selectedFile) {
                let filePath = null;
                if (Array.isArray(selectedFile) && selectedFile.length > 0) filePath = selectedFile[0];
                else if (typeof selectedFile === 'string') filePath = selectedFile;

                if (filePath) {
                    const dirPath = filePath.substring(0, filePath.lastIndexOf(filePath.includes('\\') ? '\\' : '/'));

                    if (dirPath === '' || dirPath === '/' || dirPath.match(/^[a-zA-Z]:\\$/)) {
                        alert('❌ Please select a file inside a project folder, not root.');
                        return;
                    }

                    await loadProject(dirPath);
                }
            }
        } else {
            // Directory selection
            const selectedDir = await open({
                directory: true,
                multiple: false,
                defaultPath: await invoke('get_home_dir')
            });

            if (selectedDir) {
                await loadProject(selectedDir);
            }
        }
    } catch (e) {
        if (!e.message?.includes('callback id') && !e.message?.includes('cancelled')) {
            console.warn('❌ Open folder failed:', e);
            alert('Failed to open folder: ' + e);
        }
    }
}

async function loadProject(path) {
    try {
        console.log('Loading project:', path);
        const root = await invoke('open_project', { root: path });

        currentProjectRoot = root.path;
        renderTree(root.children, fileTreeEl);

        // Update Recent Projects
        let recent = JSON.parse(localStorage.getItem('recent_projects') || '[]');
        if (!Array.isArray(recent)) recent = [];
        recent = recent.filter(p => p !== path);
        recent.unshift(path);
        if (recent.length > 10) recent.pop();
        localStorage.setItem('recent_projects', JSON.stringify(recent));

        // Update Git Panel
        await updateGitBranch();
        if (!gitPanel) {
            gitPanel = new GitPanel();
            gitPanel.setPath(currentProjectRoot);
            setupGitMenu();
        } else {
            gitPanel.setPath(currentProjectRoot);
            gitPanel.refresh();
        }

        console.log('✅ Project loaded:', path);
    } catch (e) {
        console.error('Failed to load project:', e);
        throw e;
    }
}

function renderTree(entries, parentElement, depth = 0) {
    if (depth > 5) {
        parentElement.innerHTML = '<div class="text-gray-500 text-xs px-4 py-1">... (depth limit reached)</div>';
        return;
    }

    parentElement.innerHTML = '';
    entries.sort((a, b) => (b.is_dir - a.is_dir) || a.name.localeCompare(b.name)).forEach(entry => {
        const div = document.createElement('div');
        div.className = entry.is_dir ? 'folder-item' : 'file-item';
        div.innerHTML = `<span>${entry.is_dir ? '📁' : '📄'}</span> <span>${entry.name}</span>`;
        if (!entry.is_dir) div.onclick = () => openFile(entry.path);
        else {
            let expanded = false;
            div.onclick = async () => {
                if (div.dataset.loading === "true") return;
                try {
                    div.dataset.loading = "true";
                    expanded = !expanded;
                    if (expanded) {
                        console.log('Expanding folder:', entry.name, 'at path:', entry.path);
                        const sub = document.createElement('div');
                        sub.className = 'sub-folder';
                        div.after(sub);
                        const updated = await invoke('read_dir', { path: entry.path });
                        console.log('Read directory result:', updated);
                        renderTree(updated, sub, depth + 1);
                    } else {
                        if (div.nextElementSibling) div.nextElementSibling.remove();
                    }
                } catch (e) {
                    console.error("Folder expansion error for", entry.path, ":", e);
                } finally {
                    div.dataset.loading = "false";
                }
            };
        }
        parentElement.appendChild(div);
    });
}

// Sidebar Toggles
const gitToggleBtn = document.getElementById('git-panel-toggle');
const explorerToggleBtn = document.getElementById('explorer-panel-toggle');
const explorerPanel = document.getElementById('explorer-panel');
const gitPanelEl = document.getElementById('git-panel');

if (gitToggleBtn) {
    gitToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent bubbling
        if (explorerPanel) explorerPanel.classList.add('hidden');
        if (gitPanelEl) {
            gitPanelEl.classList.remove('hidden');
            // Initialize Git panel if needed
            if (!gitPanel) {
                gitPanel = new GitPanel();
                if (currentProjectRoot) gitPanel.setPath(currentProjectRoot);
                setupGitMenu();
            } else {
                gitPanel.refresh();
            }
        }
    });
}

if (explorerToggleBtn) {
    explorerToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (gitPanelEl) gitPanelEl.classList.add('hidden');
        if (explorerPanel) explorerPanel.classList.remove('hidden');
    });
}

openDirBtn.addEventListener('click', openProjectDialog);

// Menu Event Handlers
document.getElementById('action-open-file')?.addEventListener('click', async () => {
    try {
        const selected = await open({
            multiple: false,
            defaultPath: await invoke('get_home_dir')
        });

        if (selected && selected.length > 0) {
            await openFile(selected[0]);
        }
    } catch (e) {
        if (!e.message?.includes('callback id')) {
            console.warn('Open file failed:', e);
        }
    }
});

document.getElementById('action-save-file')?.addEventListener('click', saveFile);

// Additional Menu Actions
document.getElementById('action-new-file')?.addEventListener('click', () => {
    currentFilePath = null;
    editor.setValue('// New file');
    if (statusName) {
        statusName.innerText = 'Untitled';
    }
});

document.getElementById('action-open-folder')?.addEventListener('click', openProjectDialog);

document.getElementById('action-exit')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to exit?')) {
        window.close();
    }
});

// Edit Menu Actions
document.getElementById('action-undo')?.addEventListener('click', () => {
    editor.trigger('', 'undo', null);
});

document.getElementById('action-redo')?.addEventListener('click', () => {
    editor.trigger('', 'redo', null);
});

document.getElementById('action-cut')?.addEventListener('click', () => {
    editor.trigger('', 'editor.action.clipboardCutAction', null);
});

document.getElementById('action-copy')?.addEventListener('click', () => {
    editor.trigger('', 'editor.action.clipboardCopyAction', null);
});

document.getElementById('action-paste')?.addEventListener('click', () => {
    editor.trigger('', 'editor.action.clipboardPasteAction', null);
});

document.getElementById('action-find')?.addEventListener('click', () => {
    editor.trigger('', 'actions.find', null);
});

// Selection Menu Actions
document.getElementById('action-select-all')?.addEventListener('click', () => {
    editor.trigger('', 'editor.action.selectAll', null);
});

document.getElementById('action-expand-select')?.addEventListener('click', () => {
    editor.trigger('', 'editor.action.smartSelect.grow', null);
});

// View Menu Actions
document.getElementById('action-toggle-sidebar')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('hidden');
});

document.getElementById('action-toggle-panel')?.addEventListener('click', () => {
    const panel = document.getElementById('terminal-panel');
    panel.classList.toggle('hidden');
});

document.getElementById('action-zoom-in')?.addEventListener('click', () => {
    const currentZoom = parseFloat(editor.getOption(monaco.editor.EditorOption.fontSize)) || 14;
    editor.updateOptions({ fontSize: Math.min(currentZoom + 2, 40) });
});

document.getElementById('action-zoom-out')?.addEventListener('click', () => {
    const currentZoom = parseFloat(editor.getOption(monaco.editor.EditorOption.fontSize)) || 14;
    editor.updateOptions({ fontSize: Math.max(currentZoom - 2, 8) });
});

// Go Menu Actions
document.getElementById('action-go-file')?.addEventListener('click', async () => {
    try {
        const selected = await open({
            multiple: false,
            defaultPath: await invoke('get_home_dir')
        });
        if (selected && selected.length > 0) {
            await openFile(selected[0]);
        }
    } catch (e) {
        if (!e.message?.includes('callback id')) {
            console.warn('Go to file failed:', e);
        }
    }
});

document.getElementById('action-go-line')?.addEventListener('click', () => {
    const line = prompt('Enter line number:');
    if (line && !isNaN(line)) {
        const lineNumber = parseInt(line);
        editor.setPosition({ lineNumber, column: 1 });
        editor.revealLineInCenter(lineNumber);
    }
});

// Run Menu Actions
document.getElementById('action-run-task')?.addEventListener('click', () => {
    alert('Run Task functionality not yet implemented');
});

document.getElementById('action-start-debug')?.addEventListener('click', () => {
    alert('Debug functionality not yet implemented');
});

// Terminal Menu Actions
document.getElementById('action-new-terminal')?.addEventListener('click', async () => {
    try {
        await invoke('spawn_terminal');
    } catch (e) {
        if (!e.message?.includes('callback id')) {
            console.warn('New terminal failed:', e);
        }
    }
});

document.getElementById('action-split-terminal')?.addEventListener('click', () => {
    alert('Split terminal functionality not yet implemented');
});

// Help Menu Actions
document.getElementById('action-welcome')?.addEventListener('click', () => {
    alert('Welcome to KERN Editor!\n\nFeatures:\n• File editing with Monaco Editor\n• Terminal integration\n• AI Assistant (Vibe)\n• Project explorer\n• Multiple language support');
});

document.getElementById('action-about')?.addEventListener('click', async () => {
    try {
        await import('./src/about.js').then(module => {
            module.showAboutDialog();
        });
    } catch (error) {
        console.error('Failed to load about dialog:', error);
    }
});

// Menu Dropdown Functionality
document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menuId = btn.getAttribute('data-menu');
        const dropdown = document.getElementById(`dropdown-${menuId}`);

        // Close all other dropdowns
        document.querySelectorAll('.menu-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.add('hidden');
        });

        // Toggle current dropdown
        dropdown?.classList.toggle('hidden');
    });
});

// Close dropdowns when clicking outside
document.addEventListener('click', () => {
    document.querySelectorAll('.menu-dropdown').forEach(d => {
        d.classList.add('hidden');
    });
});

// Prevent dropdowns from closing when clicking inside
document.querySelectorAll('.menu-dropdown').forEach(dropdown => {
    dropdown.addEventListener('click', (e) => e.stopPropagation());
});

// Terminal
const termContainer = document.getElementById('panel-content-terminal');
let terminalInitialized = false;

async function initTerminal() {
    if (terminalInitialized || window.location.pathname === '/auth-success') return;

    const term = new Terminal({
        theme: {
            background: '#1e1e1e',
            foreground: '#cccccc',
            cursor: '#ffffff',
            selection: '#264f78',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5'
        },
        fontSize: 12,
        fontFamily: 'Cascadia Code, Consolas, "Ubuntu Mono", monospace',
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        allowTransparency: false,
        cols: 80,
        rows: 24
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termContainer);
    fitAddon.fit();

    // Handle terminal data from backend
    if (window.location.pathname !== '/auth-success' && !window.location.href.includes('github-oauth')) {
        await listen('term-data', (e) => term.write(e.payload));
    }

    // Handle user input
    term.onData(data => invoke('write_to_terminal', { data }));

    // Handle terminal resize
    const resizeTerminal = () => {
        fitAddon.fit();
        const { cols, rows } = term;
        invoke('resize_terminal', { cols, rows }).catch(e => {
            if (!e.message?.includes('callback id')) {
                console.warn('Terminal resize failed:', e);
            }
        });
    };

    // Initial resize
    resizeTerminal();

    // Handle window resize
    window.addEventListener('resize', resizeTerminal);

    // Handle panel resize (when terminal panel is shown/hidden)
    const observer = new ResizeObserver(resizeTerminal);
    observer.observe(termContainer);

    try {
        await invoke('spawn_terminal');
        terminalInitialized = true;
    } catch (e) {
        if (!e.message?.includes('callback id')) {
            console.warn('Terminal initialization failed:', e);
        }
    }
}
// Terminal Tab Functionality (VS Code-like)
function initTerminalTabs() {
    const tabs = {
        'tab-problems': 'panel-content-problems',
        'tab-output': 'panel-content-output',
        'tab-debug': 'panel-content-debug',
        'tab-terminal': 'panel-content-terminal',
        'tab-ports': 'panel-content-ports'
    };

    Object.keys(tabs).forEach(tabId => {
        const tab = document.getElementById(tabId);
        const panel = document.getElementById(tabs[tabId]);

        tab?.addEventListener('click', () => {
            // Hide all panels
            Object.values(tabs).forEach(panelId => {
                const p = document.getElementById(panelId);
                p?.classList.add('hidden');
            });

            // Remove active styling from all tabs
            Object.keys(tabs).forEach(tId => {
                const t = document.getElementById(tId);
                t?.classList.remove('text-gray-200', 'font-medium', 'border-b', 'border-white');
                t?.classList.add('text-gray-500', 'border-b', 'border-transparent');
            });

            // Show selected panel
            panel?.classList.remove('hidden');

            // Add active styling to selected tab
            tab.classList.remove('text-gray-500', 'border-transparent');
            tab.classList.add('text-gray-200', 'font-medium', 'border-white');
        });
    });
}

// User Ports Detection
async function loadUserPorts() {
    try {
        const ports = await invoke('get_user_ports');
        const tbody = document.getElementById('ports-table-body');

        if (!tbody) return;

        tbody.innerHTML = '';

        if (ports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">No active ports found</td></tr>';
            return;
        }

        ports.forEach(port => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-[#2a2d2e]';
            tr.innerHTML = `
                <td class="px-4 py-1 text-blue-400 underline cursor-pointer"
                    onclick="window.open('http://${port.local_address}')">${port.port}</td>
                <td class="px-4 py-1">${port.protocol}</td>
                <td class="px-4 py-1">${port.process}</td>
                <td class="px-4 py-1">${port.local_address}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        if (!e.message?.includes('callback id')) {
            console.warn('Failed to load user ports:', e);
        }
    }
}

// Load ports when ports tab is clicked
document.getElementById('tab-ports')?.addEventListener('click', loadUserPorts);

// Refresh ports periodically
setInterval(() => {
    const portsPanel = document.getElementById('panel-content-ports');
    if (portsPanel && !portsPanel.classList.contains('hidden')) {
        loadUserPorts();
    }
}, 5000); // Refresh every 5 seconds

// Terminal Toolbar Functionality
document.getElementById('btn-term-new')?.addEventListener('click', async () => {
    try {
        await invoke('spawn_terminal');
    } catch (e) {
        if (!e.message?.includes('callback id')) {
            console.warn('New terminal failed:', e);
        }
    }
});

document.getElementById('btn-term-kill')?.addEventListener('click', async () => {
    try {
        await invoke('kill_terminal');
        // Clear terminal display
        const termContainer = document.getElementById('panel-content-terminal');
        if (termContainer) {
            termContainer.innerHTML = '';
            // Reinitialize terminal
            terminalInitialized = false;
            initTerminal();
        }
    } catch (e) {
        if (!e.message?.includes('callback id')) {
            console.warn('Kill terminal failed:', e);
        }
    }
});

document.getElementById('btn-term-max')?.addEventListener('click', () => {
    const panel = document.getElementById('terminal-panel');
    if (panel) {
        // Toggle maximized state
        if (panel.style.height === '100vh') {
            panel.style.height = '24rem'; // Reset to default
        } else {
            panel.style.height = '100vh'; // Maximize
        }
        // Trigger resize
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 100);
    }
});

document.getElementById('btn-term-close')?.addEventListener('click', () => {
    const panel = document.getElementById('terminal-panel');
    if (panel) {
        panel.classList.add('hidden');
        // Switch to first tab
        document.getElementById('tab-problems')?.click();
    }
});

// Split Terminal functionality

document.getElementById('btn-term-split')?.addEventListener('click', async () => {
    try {
        const terminalId = await invoke('split_terminal');

        // Create new terminal container for split view
        const terminalContainer = document.getElementById('panel-content-terminal');
        if (terminalContainer) {
            // Create split layout
            if (!terminalContainer.querySelector('.split-container')) {
                const splitContainer = document.createElement('div');
                splitContainer.className = 'split-container flex h-full';
                splitContainer.style.display = 'flex';
                splitContainer.style.gap = '1px';
                splitContainer.style.backgroundColor = '#1e1e1e';

                // Move existing terminal to split container
                const existingTerminal = terminalContainer.querySelector('.xterm');
                if (existingTerminal) {
                    const firstPane = document.createElement('div');
                    firstPane.className = 'flex-1';
                    firstPane.appendChild(existingTerminal);
                    splitContainer.appendChild(firstPane);
                }

                terminalContainer.appendChild(splitContainer);
            }

            // Add new terminal pane
            const splitContainer = terminalContainer.querySelector('.split-container');
            if (splitContainer) {
                const newPane = document.createElement('div');
                newPane.className = 'flex-1';
                newPane.innerHTML = `<div id="terminal-${terminalId}" class="h-full"></div>`;
                splitContainer.appendChild(newPane);

                // Initialize new terminal
                const newTermContainer = document.getElementById(`terminal-${terminalId}`);
                if (newTermContainer) {
                    const term = new Terminal({
                        theme: {
                            background: '#1e1e1e',
                            foreground: '#cccccc',
                            cursor: '#ffffff',
                            selection: '#264f78'
                        },
                        fontSize: 12,
                        fontFamily: 'Cascadia Code, Consolas, "Ubuntu Mono", monospace',
                        cursorBlink: true,
                        cursorStyle: 'block',
                        scrollback: 10000
                    });

                    const fitAddon = new FitAddon();
                    term.loadAddon(fitAddon);
                    term.open(newTermContainer);
                    fitAddon.fit();

                    // Listen for split terminal data
                    if (window.location.pathname !== '/auth-success' && !window.location.href.includes('github-oauth')) {
                        await listen('term-data-split', (e) => term.write(e.payload));
                    }
                    term.onData(data => invoke('write_to_terminal', { data }));

                    // Handle resize
                    const resizeTerminal = () => {
                        fitAddon.fit();
                        const { cols, rows } = term;
                        invoke('resize_terminal', { cols, rows }).catch(e => {
                            if (!e.message?.includes('callback id')) {
                                console.warn('Terminal resize failed:', e);
                            }
                        });
                    };

                    setTimeout(resizeTerminal, 100);
                }
            }
        }
    } catch (e) {
        if (!e.message?.includes('callback id')) {
            console.warn('Split terminal failed:', e);
        }
    }
});

// Problems Tab Functionality
function initProblemsTab() {
    const problemsContainer = document.getElementById('panel-content-problems');
    if (problemsContainer) {
        problemsContainer.innerHTML = `
            <div class="p-4 text-gray-400 text-sm">
                <div class="mb-2 font-semibold">No problems detected</div>
                <div class="text-xs text-gray-500">Issues in your code will appear here</div>
            </div>
        `;
    }
}

// Output Tab Functionality
function initOutputTab() {
    const outputContainer = document.getElementById('panel-content-output');
    if (outputContainer) {
        outputContainer.innerHTML = `
            <div class="p-4 font-mono text-xs text-gray-300" id="output-content">
                <div class="text-gray-500">// Output will appear here</div>
            </div>
        `;
    }
}

// Debug Console Tab Functionality  
function initDebugConsole() {
    const debugContainer = document.getElementById('panel-content-debug');
    if (debugContainer) {
        debugContainer.innerHTML = `
            <div class="p-4 font-mono text-xs text-gray-300">
                <div class="mb-2 text-gray-500">// Debug Console</div>
                <div class="flex items-center">
                    <span class="text-green-400 mr-2">></span>
                    <input type="text" id="debug-input" class="bg-transparent outline-none flex-1" placeholder="Type debug commands...">
                </div>
            </div>
        `;

        // Add debug input functionality
        const debugInput = document.getElementById('debug-input');
        if (debugInput) {
            debugInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const command = e.target.value;
                    if (command.trim()) {
                        // Add command to output
                        const outputContent = debugContainer.querySelector('#output-content') || debugContainer;
                        const commandDiv = document.createElement('div');
                        commandDiv.className = 'text-green-400 mb-1';
                        commandDiv.textContent = `> ${command}`;
                        outputContent.appendChild(commandDiv);

                        // Process command (placeholder)
                        const resultDiv = document.createElement('div');
                        resultDiv.className = 'text-gray-300 mb-2';
                        resultDiv.textContent = `Debug command "${command}" not implemented yet`;
                        outputContent.appendChild(resultDiv);

                        // Clear input
                        e.target.value = '';

                        // Scroll to bottom
                        debugContainer.scrollTop = debugContainer.scrollHeight;
                    }
                }
            });
        }
    }
}

// Update LSP status in status bar
function updateLSPStatus(language, active) {
    const lspStatus = document.getElementById('lsp-status');
    if (lspStatus) {
        lspStatus.textContent = active ? `LSP: ${language}` : 'LSP: Off';
        lspStatus.className = active ? 'text-green-400' : 'text-gray-500';
    }
}

// Add LSP status to status bar if not exists
function addLSPStatusIndicator() {
    const statusBar = document.getElementById('status-bar-container');
    if (statusBar && !document.getElementById('lsp-status')) {
        const rightSection = statusBar.querySelector('.flex.items-center.h-full.space-x-4:last-child');
        if (rightSection) {
            const lspStatus = document.createElement('div');
            lspStatus.id = 'lsp-status';
            lspStatus.className = 'hover:bg-[#ffffff20] px-2 h-full flex items-center cursor-pointer text-gray-500';
            lspStatus.textContent = 'LSP: Off';
            lspStatus.title = 'Language Server Protocol Status';
            rightSection.insertBefore(lspStatus, rightSection.firstChild);
        }
    }
}

// Initialize LSP status indicator
addLSPStatusIndicator();

// Initialize all tabs
initProblemsTab();
initOutputTab();
initDebugConsole();

// Console logging to Output tab
const originalConsoleLog = console.log;
console.log = function (...args) {
    originalConsoleLog(...args);
    const outputContainer = document.getElementById('panel-content-output');
    if (outputContainer) {
        const outputContent = outputContainer.querySelector('#output-content') || outputContainer;
        const logDiv = document.createElement('div');
        logDiv.className = 'text-gray-300 mb-1';
        logDiv.textContent = args.join(' ');
        outputContent.appendChild(logDiv);
        outputContainer.scrollTop = outputContainer.scrollHeight;
    }
};

initTerminalTabs();
initTerminal();

// GitHub Auth Handler
async function handleGitHubAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const userParam = urlParams.get('user');

    if (token && userParam) {
        try {
            const user = JSON.parse(decodeURIComponent(userParam));
            localStorage.setItem('github_token', token);
            localStorage.setItem('github_user', JSON.stringify(user));

            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);

            // Update UI
            console.log('GitHub authentication successful:', user.login);

            // Force UI update by dispatching a custom event
            window.dispatchEvent(new CustomEvent('github-auth-success', { detail: { token, user } }));

        } catch (error) {
            console.error('Failed to handle GitHub auth callback:', error);
        }
    }
}

// Listen for Tauri auth events only in main window
if (window.__TAURI__ && window.location.pathname !== '/auth-success' && !window.location.href.includes('github-oauth')) {
    listen('auth-success', (event) => {
        console.log('Received auth success event from Tauri:', event.payload);
        const { token, user } = event.payload;
        localStorage.setItem('github_token', token);
        localStorage.setItem('github_user', JSON.stringify(user));

        // Force UI update
        window.dispatchEvent(new CustomEvent('github-auth-success', { detail: { token, user } }));
    });
}

// Listen for postMessage from OAuth window
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'github-auth-success') {
        console.log('Received auth data via postMessage:', event.data);
        const { token, user } = event.data;
        localStorage.setItem('github_token', token);
        localStorage.setItem('github_user', JSON.stringify(user));

        // Force UI update
        window.dispatchEvent(new CustomEvent('github-auth-success', { detail: { token, user } }));
    }
});

// Also check for temp localStorage items (fallback method) - check more frequently
setInterval(() => {
    const tempToken = localStorage.getItem('github_token_temp');
    const tempUser = localStorage.getItem('github_user_temp');

    if (tempToken && tempUser) {
        console.log('Found temp auth data in localStorage');
        localStorage.setItem('github_token', tempToken);
        localStorage.setItem('github_user', tempUser);
        localStorage.removeItem('github_token_temp');
        localStorage.removeItem('github_user_temp');

        try {
            const user = JSON.parse(tempUser);
            console.log('Parsed user data:', user);
            window.dispatchEvent(new CustomEvent('github-auth-success', { detail: { token: tempToken, user } }));
        } catch (e) {
            console.error('Failed to parse temp user data:', e);
        }
    }
}, 500); // Check every 500ms instead of 1000ms

// Handle auth callback on page load
handleGitHubAuthCallback();

// Bootstrap Lazy Modules
async function bootstrap() {
    // Don't initialize modules in OAuth window
    if (window.location.pathname === '/auth-success') {
        return;
    }

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
            vibeSaveBtn: document.getElementById('save-vibe-settings'),
            vibeToggleBtn: document.getElementById('toggle-vibe-btn'),
            closeVibeBtn: document.getElementById('close-vibe-btn')
        }
    };

    vibe.initVibe(appState);
    settings.initSettings(appState);

    // Setup Wizard Logic
    checkSetupWizard();
}
bootstrap();

function checkSetupWizard() {
    // Check if setup is complete
    if (!localStorage.getItem('kern_setup_complete')) {
        const overlay = document.getElementById('wizard-overlay');
        const frame = document.getElementById('wizard-frame');

        if (overlay && frame) {
            frame.src = 'wizard.html';
            overlay.classList.remove('hidden');

            // Listen for messages from wizard
            window.addEventListener('message', async (event) => {
                const { type, action } = event.data;

                if (type === 'WIZARD_COMPLETE') {
                    localStorage.setItem('kern_setup_complete', 'true');
                    overlay.classList.add('hidden');
                    frame.src = ''; // Clear iframe

                    if (action === 'open') {
                        openProjectDialog();
                    } else if (action === 'clone') {
                        // TODO: Implement clone dialog or open terminal with git clone hint
                        invoke('spawn_terminal'); // Open terminal as a start
                    }
                } else if (type === 'WIZARD_AUTH_GITHUB') {
                    // Reuse GitPanel logic if possible, or direct invoke
                    try {
                        // Ensure GitPanel is initialized to handle the state
                        if (!gitPanel) {
                            gitPanel = new GitPanel();
                        }
                        await gitPanel.handleSignIn();
                        // Verify if auth was successful (gitPanel state or localStorage)
                        // gitPanel.handleSignIn is async and handles the UI update

                        // Optional: Notify wizard of success to change button state?
                        // For now, allow the user to click Next manually
                    } catch (e) {
                        console.error('Wizard Auth Failed:', e);
                    }
                } else if (type === 'WIZARD_AUTH_GOOGLE') {
                    try {
                        if (!gitPanel) {
                            gitPanel = new GitPanel();
                        }
                        await gitPanel.handleGoogleSignIn();
                    } catch (e) {
                        console.error('Wizard Google Auth Failed:', e);
                    }
                }
            });
        }
    }
}
