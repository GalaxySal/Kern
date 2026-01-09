import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/api/shell';
import { listen } from '@tauri-apps/api/event';

export default function GitHubAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Check if already authenticated
    const storedToken = localStorage.getItem('github_token');
    const storedUser = localStorage.getItem('github_user');
    
    if (storedToken && storedUser) {
      try {
        setIsAuthenticated(true);
        setUser(JSON.parse(storedUser));
      } catch (e) {
        console.error('Failed to parse stored user:', e);
        localStorage.removeItem('github_token');
        localStorage.removeItem('github_user');
      }
    }

    // Listen for auth success events only in main window
    let unlistenPromise = Promise.resolve(() => {});
    
    if (window.__TAURI__ && window.location.pathname !== '/auth-success') {
      unlistenPromise = listen('auth-success', (event) => {
        console.log('Auth success event received:', event.payload);
        const { token, user } = event.payload;
        localStorage.setItem('github_token', token);
        localStorage.setItem('github_user', JSON.stringify(user));
        setIsAuthenticated(true);
        setUser(user);
        setError('');
        setIsLoading(false);
      });
    }

    // Also check URL params for auth callback
    const checkUrlParams = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      const userParam = urlParams.get('user');
      
      if (token && userParam) {
        try {
          const userData = JSON.parse(decodeURIComponent(userParam));
          localStorage.setItem('github_token', token);
          localStorage.setItem('github_user', JSON.stringify(userData));
          
          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
          
          setIsAuthenticated(true);
          setUser(userData);
          setError('');
          setIsLoading(false);
          
          console.log('GitHub authentication successful:', userData.login);
        } catch (error) {
          console.error('Failed to handle auth callback:', error);
          setError('Authentication failed');
        }
      }
    };

    // Listen for custom auth events
    const handleCustomAuthEvent = (event) => {
      console.log('Custom auth event received:', event.detail);
      const { token, user } = event.detail;
      localStorage.setItem('github_token', token);
      localStorage.setItem('github_user', JSON.stringify(user));
      setIsAuthenticated(true);
      setUser(user);
      setError('');
      setIsLoading(false);
    };

    window.addEventListener('github-auth-success', handleCustomAuthEvent);

    // Check for temp localStorage data periodically
    const checkTempData = () => {
      const tempToken = localStorage.getItem('github_token_temp');
      const tempUser = localStorage.getItem('github_user_temp');
      
      if (tempToken && tempUser) {
        console.log('GitHubAuth: Found temp auth data');
        localStorage.setItem('github_token', tempToken);
        localStorage.setItem('github_user', tempUser);
        localStorage.removeItem('github_token_temp');
        localStorage.removeItem('github_user_temp');
        
        try {
          const userData = JSON.parse(tempUser);
          setIsAuthenticated(true);
          setUser(userData);
          setError('');
          setIsLoading(false);
          console.log('GitHubAuth: Authentication successful from temp data:', userData.login);
        } catch (e) {
          console.error('GitHubAuth: Failed to parse temp user data:', e);
        }
      }
    };

    const tempDataInterval = setInterval(checkTempData, 500);

    checkUrlParams();

    return () => {
      unlistenPromise.then(unlisten => unlisten());
      window.removeEventListener('github-auth-success', handleCustomAuthEvent);
      clearInterval(tempDataInterval);
    };
  }, []);

  const handleGitHubLogin = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Open GitHub OAuth in external browser with callback to main window
      const response = await fetch('http://localhost:3001/auth/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_tauri: false, // Force web mode to use browser
          redirect_uri: 'http://localhost:3001/auth/callback'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get auth URL');
      }

      const { url } = await response.json();
      console.log('Opening GitHub OAuth URL in external browser:', url);
      
      // Force opening in external browser using window.open
      window.open(url, '_blank');
      
    } catch (err) {
      setError(`Authentication failed: ${err.message}`);
      console.error('GitHub auth error:', err);
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('github_token');
    localStorage.removeItem('github_user');
    setIsAuthenticated(false);
    setUser(null);
  };

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center space-x-2 p-2 bg-[#252526] border border-[#333] rounded">
        <img 
          src={user.avatar_url || 'https://github.com/github.png'} 
          alt={user.login}
          className="w-6 h-6 rounded-full"
        />
        <span className="text-sm text-gray-300">{user.login}</span>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-400 hover:text-red-400 transition-colors"
          title="Logout from GitHub"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-[#252526] border border-[#333] rounded">
      <div className="text-center">
        <h3 className="text-sm font-medium text-gray-300 mb-2">GitHub Integration</h3>
        <p className="text-xs text-gray-500 mb-4">
          Connect your GitHub account to enable repository features
        </p>
        
        {error && (
          <div className="mb-3 p-2 bg-red-900/20 border border-red-700 rounded text-xs text-red-400">
            {error}
          </div>
        )}
        
        <button
          onClick={handleGitHubLogin}
          disabled={isLoading}
          className="flex items-center space-x-2 mx-auto px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 text-white rounded transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          <span className="text-sm">
            {isLoading ? 'Connecting...' : 'Connect GitHub'}
          </span>
        </button>
        
        <div className="mt-3 text-xs text-gray-500">
          <p>• Clone and push repositories</p>
          <p>• Sync with remote branches</p>
          <p>• Manage pull requests</p>
        </div>
      </div>
    </div>
  );
}
