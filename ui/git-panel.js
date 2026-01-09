import { invoke } from '@tauri-apps/api/core';

export class GitPanel {
  constructor() {
    this.currentPath = null;
    this.githubToken = localStorage.getItem('github_token') || '';
    this.githubUser = JSON.parse(localStorage.getItem('github_user') || 'null');

    // Bind methods
    this.refresh = this.refreshGitStatus.bind(this);
    this.pull = this.handlePull.bind(this);
    this.push = this.handlePush.bind(this);
    this.commit = this.handleCommit.bind(this);

    // UI Elements
    this.els = {
      panel: document.getElementById('git-panel'),
      toggleBtn: document.getElementById('git-panel-toggle'),
      refreshBtn: document.getElementById('refresh-git'),
      stageAllBtn: document.getElementById('git-stage-all'),
      commitBtn: document.getElementById('git-commit'),
      pushBtn: document.getElementById('git-push'),
      commitMsg: document.getElementById('git-commit-message'),
      branchInfo: document.getElementById('git-branch-info'),
      status: document.getElementById('git-status'),
      staged: document.getElementById('staged-files'),
      unstaged: document.getElementById('unstaged-files'),
      signInBtn: document.getElementById('github-signin'),
      googleSignInBtn: document.getElementById('google-signin'),
      signOutBtn: document.getElementById('github-signout'),
      userDiv: document.getElementById('github-user'),
      avatar: document.getElementById('github-avatar'),
      username: document.getElementById('github-username')
    };

    this.init();
  }

  async init() {
    console.log('Initializing GitPanel...');
    this.bindEvents();
    if (this.els.googleSignInBtn) {
      this.els.googleSignInBtn.addEventListener('click', () => this.handleGoogleSignIn());
    }
    this.updateGitHubUI();
    this.setupOAuthHandlers();

    // Listen for directory changes if main.js calls us
    // We expose a setter for path
  }

  setPath(path) {
    console.log('GitPanel path updated:', path);
    this.currentPath = path;
    if (path) {
      this.refreshGitStatus();
    }
  }

  bindEvents() {
    // this.els.toggleBtn listener removed to avoid conflict with main.js layout management

    this.els.refreshBtn?.addEventListener('click', () => this.refreshGitStatus());

    this.els.stageAllBtn?.addEventListener('click', async () => {
      if (!this.currentPath) return;
      try {
        await invoke('git_stage_all', { repo_path: this.currentPath });
        this.refreshGitStatus();
      } catch (error) {
        this.showError('Failed to stage changes: ' + error);
      }
    });

    this.els.commitBtn?.addEventListener('click', () => this.handleCommit());
    this.els.pushBtn?.addEventListener('click', () => this.handlePush());

    this.els.signInBtn?.addEventListener('click', () => this.handleSignIn());
    this.els.signOutBtn?.addEventListener('click', () => this.handleSignOut());
  }

  async refreshGitStatus() {
    if (!this.currentPath) return;

    try {
      const status = await invoke('git_status', { repoPath: this.currentPath });
      this.updateGitUI(status);
    } catch (error) {
      console.warn('Git status error:', error);
      // Don't just show error, update UI to reflect "No Repo" state so panel stays valid
      this.updateGitUI({
        is_dirty: false,
        branch: 'No Repo',
        ahead: 0,
        behind: 0,
        staged_files: [],
        modified_files: [],
        untracked_files: []
      });
      // Show error but less aggressively if it's just "not a git repo"
      if (typeof error === 'string' && error.includes('Not a git repository')) {
        this.showError('Not a git repository');
      } else {
        this.showError('Git Error: ' + error);
      }
    }
  }

  updateGitUI(status) {
    if (!status) return;

    // Update branch info
    if (this.els.branchInfo) {
      this.els.branchInfo.textContent = `🌿 ${status.branch} ${status.ahead > 0 ? `↑${status.ahead}` : ''}${status.behind > 0 ? `↓${status.behind}` : ''}`;
    }

    // Update status text
    if (this.els.status) {
      this.els.status.innerHTML = status.is_dirty
        ? '🔄 There are uncommitted changes'
        : '✅ Working tree clean';
    }

    // Update staged files
    if (this.els.staged) {
      this.els.staged.innerHTML = status.staged_files && status.staged_files.length > 0
        ? status.staged_files.map(file => `
            <div class="flex items-center justify-between p-1 hover:bg-[#2a2d2e] rounded">
              <span class="truncate">${file}</span>
              <span class="text-green-500 text-xs">staged</span>
            </div>`
        ).join('')
        : '<div class="text-gray-500 italic text-xs p-1">No staged files</div>';
    }

    // Update unstaged files
    if (this.els.unstaged) {
      const allUnstaged = [...(status.modified_files || []), ...(status.untracked_files || [])];
      this.els.unstaged.innerHTML = allUnstaged.length > 0
        ? allUnstaged.map(file => `
            <div class="flex items-center justify-between p-1 hover:bg-[#2a2d2e] rounded">
              <span class="truncate">${file}</span>
              <span class="text-yellow-500 text-xs">${status.untracked_files?.includes(file) ? 'untracked' : 'modified'}</span>
            </div>`
        ).join('')
        : '<div class="text-gray-500 italic text-xs p-1">No unstaged changes</div>';
    }
  }

  async handleCommit() {
    const msg = this.els.commitMsg?.value.trim();
    if (!this.currentPath || !msg) return;

    try {
      await invoke('git_commit', {
        repo_path: this.currentPath,
        message: msg
      });
      if (this.els.commitMsg) this.els.commitMsg.value = '';
      this.refreshGitStatus();
    } catch (error) {
      this.showError('Commit failed: ' + error);
    }
  }

  async handlePush() {
    if (!this.currentPath) {
      this.showError('No repository selected');
      return;
    }
    if (!this.githubToken) {
      this.showError('Please sign in to GitHub first');
      return;
    }

    try {
      const status = await invoke('git_status', { repoPath: this.currentPath });
      if (status.ahead > 0) {
        await invoke('git_push', {
          repo_path: this.currentPath,
          remote: 'origin',
          branch: status.branch || 'main',
          token: this.githubToken
        });
        this.showMessage(`Pushed ${status.ahead} commit(s)`);
        this.refreshGitStatus();
      } else {
        this.showMessage('No new commits to push');
      }
    } catch (error) {
      this.showError('Push failed: ' + error);
    }
  }

  async handlePull() {
    if (!this.currentPath) return;
    try {
      await invoke('git_pull', {
        repoPath: this.currentPath,
        remote: 'origin'
        // branch is inferred often, or we need to look it up
      });
      this.refreshGitStatus();
      this.showMessage('Pull successful');
    } catch (error) {
      this.showError('Pull failed: ' + error);
    }
  }

  // --- Auth & GitHub ---

  initGitHubAuth() {
    if (this.githubUser) {
      this.els.userDiv?.classList.remove('hidden');
      this.els.signInBtn?.classList.add('hidden');
      this.els.googleSignInBtn?.classList.add('hidden');
      if (this.els.avatar) this.els.avatar.src = this.githubUser.avatar_url || '';
      if (this.els.username) this.els.username.textContent = this.githubUser.login;
    } else {
      this.els.userDiv?.classList.add('hidden');
      this.els.signInBtn?.classList.remove('hidden');
      this.els.googleSignInBtn?.classList.remove('hidden');
    }
  }

  updateGitHubUI() {
    this.initGitHubAuth();
  }

  async handleSignIn() {
    try {
      console.log('[GitPanel] handleSignIn: Starting GitHub authentication...');
      this.showMessage('Starting GitHub authentication...');
      const response = await invoke('authenticate_github');
      console.log('[GitPanel] handleSignIn: Backend response:', response);
      if (response && response.token) {
        await this.handleNewToken(response.token, response.user);
      } else {
        console.warn('[GitPanel] handleSignIn: Response missing token:', response);
        this.showError('Authentication failed: No token received from backend');
      }
    } catch (error) {
      console.error('[GitPanel] handleSignIn: Error:', error);
      this.showError('Authentication failed: ' + error);
    }
  }

  async handleGoogleSignIn() {
    try {
      console.log('[GitPanel] handleGoogleSignIn: Starting Google authentication...');
      this.showMessage('Starting Google authentication...');
      const response = await invoke('authenticate_google');
      console.log('[GitPanel] handleGoogleSignIn: Backend response:', response);
      if (response && response.token) {
        await this.handleNewToken(response.token, response.user);
      } else {
        console.warn('[GitPanel] handleGoogleSignIn: Response missing token:', response);
        this.showError('Auth failed: No token received');
      }
    } catch (error) {
      console.error('[GitPanel] handleGoogleSignIn: Error:', error);
      this.showError('Auth failed: ' + error);
    }
  }

  handleSignOut() {
    console.log('[GitPanel] handleSignOut: Signing out...');
    localStorage.removeItem('github_token');
    localStorage.removeItem('github_user');
    this.githubToken = '';
    this.githubUser = null;
    this.initGitHubAuth();
    this.showMessage('Signed out');
  }

  async handleNewToken(token, userData) {
    console.log('[GitPanel] handleNewToken: Received token, user data exists:', !!userData);
    this.githubToken = token;
    localStorage.setItem('github_token', token);

    // Fetch user if not provided
    if (!userData) {
      try {
        console.log('[GitPanel] handleNewToken: Fetching user info from GitHub API...');
        const resp = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': `token ${token}` }
        });
        if (resp.ok) {
          userData = await resp.json();
          console.log('[GitPanel] handleNewToken: User info fetched:', userData.login);
        } else {
          console.warn('[GitPanel] handleNewToken: GitHub API error:', resp.status);
        }
      } catch (e) { console.error('[GitPanel] handleNewToken: Error fetching user:', e); }
    }

    if (userData) {
      this.githubUser = userData;
      localStorage.setItem('github_user', JSON.stringify(userData));
    }

    this.initGitHubAuth();
    this.showMessage('Signed in as ' + (this.githubUser?.login || 'User'));
    if (this.currentPath) this.refreshGitStatus(); // Refresh to enable push if ready
  }

  async setupOAuthHandlers() {
    // Listen for backend events (if any additional ones needed)
    // The main auth flow is now direct invoke, but if we used events:
    /*
    await listen('auth-success', (event) => {
        // ...
    });
    */
  }

  showError(msg) {
    if (this.els.status) {
      this.els.status.innerHTML = `<span class="text-red-400">${msg}</span>`;
      // Clear after 5s
      setTimeout(() => {
        if (this.els.status.textContent.includes(msg)) this.els.status.innerHTML = '';
      }, 5000);
    }
  }

  showMessage(msg) {
    if (this.els.status) {
      this.els.status.innerHTML = `<span class="text-green-400">${msg}</span>`;
      setTimeout(() => {
        if (this.els.status.textContent.includes(msg)) this.els.status.innerHTML = '';
      }, 3000);
    }
  }
}

// Global exposure for main.js compatibility
window.GitPanel = GitPanel;
console.log('GitPanel class registered on window');
