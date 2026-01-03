import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export async function initVibe(appState) {
    const {
        vibePanel, vibeInput, vibeSendBtn, vibeChatHistory,
        modelSelect, customModelIdInput, settingsView,
        vibeToggleBtn, closeVibeBtn
    } = appState.elements;

    const toggleVibePanel = () => {
        vibePanel.classList.toggle('hidden');
        vibePanel.classList.toggle('flex');
        if (!vibePanel.classList.contains('hidden')) {
            vibeInput.focus();
        }
    };

    vibeToggleBtn.addEventListener('click', toggleVibePanel);
    closeVibeBtn.addEventListener('click', toggleVibePanel);

    vibeSendBtn.addEventListener('click', () => sendVibePrompt(appState));
    vibeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendVibePrompt(appState);
        }
    });

    window.switchToOllama = () => {
        modelSelect.value = 'ollama';
        modelSelect.dispatchEvent(new Event('change'));
        document.getElementById('vibe-settings-btn').click();
        customModelIdInput.focus();
    };
}

async function sendVibePrompt(appState) {
    const { vibeInput, vibeSendBtn, modelSelect, customModelIdInput, vibeChatHistory } = appState.elements;
    const { editor } = appState;
    let { currentFilePath, currentProjectRoot } = appState;

    const prompt = vibeInput.value.trim();
    if (!prompt) return;

    if (!currentProjectRoot) {
        if (currentFilePath) {
            currentProjectRoot = currentFilePath.split(/[\\/]/).slice(0, -1).join('/');
        } else {
            alert('Please open a folder or a file first to give Vibe context!');
            return;
        }
    }

    vibeInput.value = '';
    vibeInput.disabled = true;
    vibeSendBtn.disabled = true;

    addVibeMessage(vibeChatHistory, 'user', prompt);

    const modelId = modelSelect.value;
    const displayModel = modelId === 'custom' ? customModelIdInput.value || 'Custom' : modelId;
    const aiMessageContainer = addVibeMessage(vibeChatHistory, 'ai', `Asking ${displayModel}...`);
    let fullAiResponse = '';

    const { marked } = await import('marked');

    const pos = editor.getPosition();
    const context = {
        file_path: currentFilePath,
        content: editor.getValue(),
        cursor_line: pos ? pos.lineNumber : null,
        cursor_col: pos ? pos.column : null
    };

    try {
        const unlisten = await listen('vibe-chunk', async (event) => {
            const chunk = event.payload;
            if (chunk.is_final) {
                unlisten();
                await renderAiResponse(aiMessageContainer, fullAiResponse, appState);
                vibeInput.disabled = false;
                vibeSendBtn.disabled = false;
                vibeInput.focus();
                return;
            }
            if (fullAiResponse === '') aiMessageContainer.innerHTML = '';
            fullAiResponse += chunk.text;
            aiMessageContainer.innerHTML = marked.parse(fullAiResponse);
            vibeChatHistory.scrollTop = vibeChatHistory.scrollHeight;
        });

        await invoke('streamVibeChat', {
            prompt,
            projectRoot: currentProjectRoot,
            modelId: modelId,
            context: context
        });
    } catch (e) {
        handleVibeError(e, aiMessageContainer, modelId, appState);
    }
}

function addVibeMessage(history, role, text) {
    const div = document.createElement('div');
    div.className = role === 'user'
        ? 'bg-[#007acc]/20 border border-[#007acc]/30 rounded-lg p-3 self-end max-w-[90%] text-gray-200 whitespace-pre-wrap'
        : 'bg-[#2d2d2d] border border-[#333] rounded-lg p-3 self-start max-w-[95%] text-gray-300';

    if (role === 'user') {
        div.textContent = text;
    } else {
        div.innerHTML = text;
    }

    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
    return div;
}

async function renderAiResponse(container, text, appState) {
    const { marked } = await import('marked');
    container.innerHTML = marked.parse(text);

    const codeBlocks = container.querySelectorAll('pre');
    codeBlocks.forEach(pre => {
        const codeElement = pre.querySelector('code');
        if (!codeElement) return;
        const code = codeElement.textContent;
        const lang = codeElement.className.replace('language-', '') || 'code';

        const wrapper = document.createElement('div');
        wrapper.className = 'my-4 bg-black rounded-md overflow-hidden border border-[#333] group relative';
        pre.parentNode.insertBefore(wrapper, pre);

        const header = document.createElement('div');
        header.className = 'flex justify-between items-center px-3 py-1 bg-[#252526] border-b border-[#333]';
        header.innerHTML = `<span class="text-[10px] uppercase text-gray-500 font-bold">${lang}</span>`;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'flex items-center space-x-2';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'text-[10px] text-gray-400 hover:text-white transition-colors';
        copyBtn.innerText = 'Copy';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(code);
            copyBtn.innerText = 'Copied!';
            setTimeout(() => copyBtn.innerText = 'Copy', 1000);
        };

        const applyBtn = document.createElement('button');
        applyBtn.className = 'text-[10px] text-blue-400 hover:text-white transition-colors font-bold';
        applyBtn.innerText = 'Apply to File';
        applyBtn.onclick = () => applyVibeCode(code, appState);

        btnContainer.appendChild(copyBtn);
        btnContainer.appendChild(applyBtn);
        header.appendChild(btnContainer);

        wrapper.appendChild(header);
        wrapper.appendChild(pre);
        pre.className = 'p-3 text-xs overflow-x-auto text-gray-300 m-0';
    });
}

async function applyVibeCode(code, appState) {
    const { currentFilePath, currentProjectRoot, openFile } = appState;
    if (!currentFilePath) {
        alert('Please open a file first to apply code!');
        return;
    }

    try {
        await invoke('applyCodeChange', {
            projectRoot: currentProjectRoot,
            filePath: currentFilePath,
            code
        });
        openFile(currentFilePath);
    } catch (e) {
        alert('Failed to apply code: ' + e);
    }
}

function handleVibeError(e, container, modelId, appState) {
    const { vibeSendBtn, vibeInput } = appState.elements;
    console.error('Vibe chat failed:', e);
    let errorTitle = 'Vibe Error';
    let errorMsg = e;

    if (e.includes('model_not_found') || e.includes('invalid_model')) {
        errorTitle = 'Model ID Mismatch';
        errorMsg = `Selected model (<strong>${modelId}</strong>) unrecognized.`;
    } else if (e.includes('429')) {
        errorTitle = 'Rate Limit';
        errorMsg = 'Exceeded cloud quota. <br><button onclick="switchToOllama()" class="bg-blue-600 px-2 py-1 rounded text-[10px] mt-2">Switch to Ollama</button>';
    }

    container.innerHTML = `<div class="bg-red-900/40 p-3 rounded-lg text-red-100 text-xs text-center">\n<strong class="block mb-1 text-sm">${errorTitle}</strong>\n<span>${errorMsg}</span>\n</div>`;
    vibeInput.disabled = false;
    vibeSendBtn.disabled = false;
}
