import { load } from '@tauri-apps/plugin-store';

export async function initSettings(appState) {
    const {
        modelSelect, customModelIdInput, customModelContainer,
        settingsView, settingsBtn, vibeSaveBtn
    } = appState.elements;

    const settingsStore = await load('settings.json');

    // Load Initial Settings
    const model = await settingsStore.get('last_model');
    if (model) {
        modelSelect.value = model;
        modelSelect.dispatchEvent(new Event('change'));
    }

    const customId = await settingsStore.get('custom_model_id');
    if (customId) customModelIdInput.value = customId;

    document.getElementById('key-openai').value = (await settingsStore.get('openai')) || '';
    document.getElementById('key-anthropic').value = (await settingsStore.get('anthropic')) || '';
    document.getElementById('key-gemini').value = (await settingsStore.get('gemini')) || '';

    // Listeners
    modelSelect.addEventListener('change', () => {
        const isLocalOrCustom = modelSelect.value === 'custom' ||
            modelSelect.value === 'ollama' ||
            modelSelect.value === 'qwen2.5-coder' ||
            modelSelect.value === 'llama3.1';

        if (isLocalOrCustom) {
            customModelContainer.classList.remove('hidden');
            if (modelSelect.value !== 'custom') {
                document.getElementById('key-openai').closest('.space-y-2').classList.add('hidden');
            } else {
                document.getElementById('key-openai').closest('.space-y-2').classList.remove('hidden');
            }
        } else {
            customModelContainer.classList.remove('hidden');
            document.getElementById('key-openai').closest('.space-y-2').classList.remove('hidden');
        }
    });

    settingsBtn.addEventListener('click', () => {
        settingsView.classList.toggle('hidden');
    });

    vibeSaveBtn.addEventListener('click', async () => {
        await settingsStore.set('openai', document.getElementById('key-openai').value.trim());
        await settingsStore.set('anthropic', document.getElementById('key-anthropic').value.trim());
        await settingsStore.set('gemini', document.getElementById('key-gemini').value.trim());
        await settingsStore.set('last_model', modelSelect.value);
        await settingsStore.set('custom_model_id', customModelIdInput.value.trim());
        await settingsStore.save();
        alert('Settings saved!');
        settingsView.classList.add('hidden');
    });

    document.getElementById('vibe-push-settings').addEventListener('click', async () => {
        try {
            const result = await window.__TAURI__.core.invoke('sync_settings', { action: 'push' });
            alert(result);
        } catch (err) {
            alert('Push failed: ' + err);
        }
    });

    document.getElementById('vibe-pull-settings').addEventListener('click', async () => {
        if (!confirm('This will overwrite your local keys. Continue?')) return;
        try {
            const result = await window.__TAURI__.core.invoke('sync_settings', { action: 'pull' });
            alert(result);
            // Reload page to refresh settings in memory
            window.location.reload();
        } catch (err) {
            alert('Pull failed: ' + err);
        }
    });
}
