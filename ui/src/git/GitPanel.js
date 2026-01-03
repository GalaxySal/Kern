import { invoke } from '@tauri-apps/api/tauri';
import { useEffect, useState } from 'react';
import GitHubAuth from '../components/GitHubAuth';

export default function GitPanel({ currentPath }) {
  const [status, setStatus] = useState(null);
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchGitStatus = async () => {
    if (!currentPath) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const status = await invoke('git_status', { repoPath: currentPath });
      setStatus(status);
      setCurrentBranch(status.branch || 'Not a git repository');
      
      if (status.branch) {
        const branches = await invoke('git_branches', { repoPath: currentPath });
        setBranches(branches);
      }
    } catch (err) {
      setError('Not a git repository or error fetching status');
      console.error('Git status error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    
    try {
      setIsLoading(true);
      await invoke('git_commit', { 
        repoPath: currentPath, 
        message: commitMessage 
      });
      setCommitMessage('');
      await fetchGitStatus(); // Refresh status after commit
    } catch (err) {
      setError(`Commit failed: ${err}`);
      console.error('Commit error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckout = async (branchName) => {
    try {
      setIsLoading(true);
      await invoke('git_checkout_branch', { 
        repoPath: currentPath, 
        branchName 
      });
      await fetchGitStatus(); // Refresh status after checkout
    } catch (err) {
      setError(`Checkout failed: ${err}`);
      console.error('Checkout error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePush = async () => {
    try {
      setIsLoading(true);
      await invoke('git_push', { 
        repoPath: currentPath,
        remote: 'origin',
        branch: currentBranch
      });
      await fetchGitStatus(); // Refresh status after push
    } catch (err) {
      setError(`Push failed: ${err}`);
      console.error('Push error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePull = async () => {
    try {
      setIsLoading(true);
      await invoke('git_pull', { 
        repoPath: currentPath,
        remote: 'origin',
        branch: currentBranch
      });
      await fetchGitStatus(); // Refresh status after pull
    } catch (err) {
      setError(`Pull failed: ${err}`);
      console.error('Pull error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh status when currentPath changes
  useEffect(() => {
    fetchGitStatus();
  }, [currentPath]);

  if (isLoading) {
    return (
      <div className="p-4 text-center text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
        <p>Loading Git status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-400 text-sm mb-2">{error}</p>
        <button 
          onClick={fetchGitStatus}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1">
          <GitHubAuth />
        </div>
        <div className="p-4 text-center border-t border-[#333]">
          <p className="text-gray-400 mb-2">Not a Git repository</p>
          <button 
            onClick={fetchGitStatus}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
          >
            Initialize Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Branch and actions header */}
      <div className="p-2 border-b border-[#333] bg-[#252526] flex items-center justify-between">
        <div className="flex items-center">
          <span className="text-xs font-medium text-gray-400 mr-2">Branch:</span>
          <div className="relative group">
            <button 
              className="text-sm font-medium text-blue-400 hover:text-blue-300 flex items-center"
              onClick={() => document.getElementById('branch-dropdown').classList.toggle('hidden')}
            >
              {currentBranch}
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div id="branch-dropdown" className="hidden absolute left-0 mt-1 w-48 bg-[#252526] border border-[#333] rounded shadow-lg z-10">
              {branches.map((branch) => (
                <div 
                  key={branch.name}
                  className={`px-3 py-1 text-sm cursor-pointer hover:bg-[#094771] ${branch.is_current ? 'text-blue-400' : 'text-gray-300'}`}
                  onClick={() => handleCheckout(branch.name)}
                >
                  {branch.name}
                  {branch.is_remote && ' (remote)'}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex space-x-1">
          <button 
            onClick={handlePull}
            className="p-1 text-gray-400 hover:text-white hover:bg-[#3c3c3c] rounded"
            title="Pull"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
          <button 
            onClick={handlePush}
            className="p-1 text-gray-400 hover:text-white hover:bg-[#3c3c3c] rounded"
            title="Push"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
          <button 
            onClick={fetchGitStatus}
            className="p-1 text-gray-400 hover:text-white hover:bg-[#3c3c3c] rounded"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Changes section */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Staged changes */}
        {status.staged_files.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-gray-400 mb-1">STAGED CHANGES</h3>
            <div className="space-y-1">
              {status.staged_files.map((file, index) => (
                <div key={`staged-${index}`} className="flex items-center text-sm text-green-400 px-2 py-1 rounded hover:bg-[#2a2d2e] cursor-pointer">
                  <span className="w-4 h-4 mr-2 text-green-500">•</span>
                  <span className="truncate">{file}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modified files */}
        {status.modified_files.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-gray-400 mb-1">MODIFIED</h3>
            <div className="space-y-1">
              {status.modified_files.map((file, index) => (
                <div key={`modified-${index}`} className="flex items-center text-sm text-yellow-400 px-2 py-1 rounded hover:bg-[#2a2d2e] cursor-pointer">
                  <span className="w-4 h-4 mr-2 text-yellow-500">•</span>
                  <span className="truncate">{file}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Untracked files */}
        {status.untracked_files.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-gray-400 mb-1">UNTRACKED</h3>
            <div className="space-y-1">
              {status.untracked_files.map((file, index) => (
                <div key={`untracked-${index}"`} className="flex items-center text-sm text-red-400 px-2 py-1 rounded hover:bg-[#2a2d2e] cursor-pointer">
                  <span className="w-4 h-4 mr-2 text-red-500">•</span>
                  <span className="truncate">{file}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {status.staged_files.length === 0 && 
         status.modified_files.length === 0 && 
         status.untracked_files.length === 0 && (
          <div className="text-center text-gray-500 text-sm p-4">
            No uncommitted changes
          </div>
        )}
      </div>

      {/* Commit message input */}
      <div className="p-2 border-t border-[#333] bg-[#252526]">
        <div className="relative">
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message..."
            className="w-full bg-[#2d2d2d] border border-[#454545] rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
            onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
          />
          <button
            onClick={handleCommit}
            disabled={!commitMessage.trim() || status.staged_files.length === 0}
            className={`absolute right-1.5 top-1/2 transform -translate-y-1/2 px-2 py-0.5 text-xs rounded ${
              commitMessage.trim() && status.staged_files.length > 0
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            Commit
          </button>
        </div>
      </div>
    </div>
  );
}
