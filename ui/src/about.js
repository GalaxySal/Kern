// about.js - Handles the About KERN dialog functionality

let aboutDialog = null;

// Tauri 2.0 APIs - Using our native commands which wrap tauri-plugin-os
const getPlatformInfo = async () => {
    try {
        if (window.__TAURI__) {
            const { invoke } = await import('@tauri-apps/api/core');
            const platform = await invoke('get_os_type');
            const version = await invoke('get_os_version');
            const arch = await invoke('get_arch');
            return { platform, version, arch };
        } else {
            return { platform: 'Web', version: '', arch: 'unknown' };
        }
    } catch (error) {
        console.warn('Error getting platform info:', error);
        return { platform: 'Unknown', version: '', arch: 'unknown' };
    }
};

const getWebviewInfo = async () => {
    try {
        if (window.__TAURI__) {
            const { invoke } = await import('@tauri-apps/api/core');
            return await invoke('get_webview_version');
        }
        return 'Browser WebView';
    } catch (error) {
        return 'Unknown WebView';
    }
};

// Browser fallback for platform detection
const getBrowserPlatformInfo = () => {
    const ua = navigator.userAgent;
    let platform = 'unknown';
    let version = '';
    let arch = 'unknown';

    if (ua.includes('Windows')) {
        platform = 'win32';
        const match = ua.match(/Windows NT ([\d.]+)/);
        version = match ? match[1] : '';
    } else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) {
        platform = 'darwin';
        const match = ua.match(/Mac OS X ([\d_]+)/);
        version = match ? match[1].replace(/_/g, '.') : '';
    } else if (ua.includes('Linux')) {
        platform = 'linux';
        version = '';
    }

    // Detect architecture
    if (ua.includes('x86_64') || ua.includes('Win64') || ua.includes('WOW64')) {
        arch = 'x86_64';
    } else if (ua.includes('ARM') || ua.includes('aarch64')) {
        arch = 'aarch64';
    }

    return { platform, version, arch };
};

// App version fallback
const getAppVersion = async () => {
    if (window.__TAURI__) {
        try {
            const { getVersion } = await import('@tauri-apps/api/app');
            return await getVersion();
        } catch (e) {
            console.warn('Could not get app version:', e);
        }
    }
    return '0.1.2';
};

// Create and show the about dialog
export async function showAboutDialog() {
    // Create dialog if it doesn't exist
    if (!aboutDialog) {
        aboutDialog = document.createElement('div');
        aboutDialog.id = 'about-dialog';
        aboutDialog.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        aboutDialog.innerHTML = `
            <div style="background: white; border-radius: 8px; width: 500px; max-width: 90%; max-height: 90vh; overflow-y: auto;">
                <div style="background-color: #2563eb; color: white; padding: 15px 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; font-size: 1.2em;">About KERN</h2>
                    <button id="close-about" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer; line-height: 1;">×</button>
                </div>
                <div style="padding: 20px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <img src="/icon.png" alt="KERN Logo" style="width: 120px; height: 120px;">
                    </div>
                    <div style="margin-bottom: 20px; color: black;">
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 500;">KERN Version</span>
                            <span>0.1.2</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 500;">Date</span>
                            <span>2025-12-28</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 500;">Tauri</span>
                            <span>2.9.5</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 500;">Rust</span>
                            <span>1.92.0 (Stable)</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 500;">OS</span>
                            <span id="os-info">Detecting...</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 500;">WebView Engine</span>
                            <span id="webview-info">Detecting...</span>
                        </div>
                    </div>
                    <div style="text-align: center; color: #666; margin-bottom: 20px;">
                        <p>KERN is a modern code editor built with web technologies.</p>
                        <p> 2025 KERN Team. All rights reserved.</p>
                        <p style="font-size: 0.9em; color: #666;">OS and WebView Engine versions are detected from the user's system.</p>
                    </div>
                    <div style="text-align: center;">
                        <button id="ok-button" style="padding: 8px 24px; background-color: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer;">OK</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(aboutDialog);

        // Close button functionality
        const closeButton = aboutDialog.querySelector('#close-about');
        const okButton = aboutDialog.querySelector('#ok-button');

        const closeDialog = () => {
            aboutDialog.style.display = 'none';
            document.body.style.overflow = 'auto';
        };

        closeButton.addEventListener('click', closeDialog);
        okButton.addEventListener('click', closeDialog);

        // Close when clicking outside the dialog
        aboutDialog.addEventListener('click', (e) => {
            if (e.target === aboutDialog) {
                closeDialog();
            }
        });

        // Close with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && aboutDialog.style.display === 'flex') {
                closeDialog();
            }
        });
    }

    // Show the dialog
    aboutDialog.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Update system info
    try {
        await updateSystemInfo();
    } catch (error) {
        console.error('Error updating system info:', error);
    }

    return aboutDialog;
}

// Update system information in the dialog
async function updateSystemInfo() {
    const osInfo = document.getElementById('os-info');
    const webviewInfo = document.getElementById('webview-info');

    try {
        if (window.__TAURI__) {
            try {
                const { platform: osName, version: osVersion, arch: architecture } = await getPlatformInfo();

                if (osInfo) {
                    osInfo.textContent = `${osName} ${osVersion || ''} (${architecture || 'unknown'})`;
                }

                // Get WebView version via native command
                if (webviewInfo) {
                    webviewInfo.textContent = await getWebviewInfo();
                }
            } catch (error) {
                console.warn('Error getting system info:', error);
                if (osInfo) {
                    osInfo.textContent = 'Unknown OS';
                }
                if (webviewInfo) {
                    webviewInfo.textContent = 'Unknown WebView';
                }
            }
        } else {
            // Web fallback
            const ua = navigator.userAgent;
            if (osInfo) {
                let osName = 'Unknown';
                if (ua.includes('Windows')) osName = 'Windows';
                else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) osName = 'macOS';
                else if (ua.includes('Linux')) osName = 'Linux';

                osInfo.textContent = `${osName} (Web)`;
            }
        }
    } catch (error) {
        console.error('Error in updateSystemInfo:', error);
    }
}

// Initialize when the DOM is fully loaded
function initializeAboutDialog() {
    const aboutButton = document.getElementById('menu-about');
    if (aboutButton) {
        // Remove any existing event listeners to prevent duplicates
        const newButton = aboutButton.cloneNode(true);
        aboutButton.parentNode.replaceChild(newButton, aboutButton);

        // Add click event listener
        newButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await showAboutDialog();
        });

        console.log('About dialog button initialized');
    } else {
        console.warn('About menu button not found. Make sure you have an element with id="menu-about"');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAboutDialog);
} else {
    initializeAboutDialog();
}
