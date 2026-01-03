use chrono::{TimeZone, Utc};
use git2::{BranchType, Commit, Repository, StatusOptions};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub is_dirty: bool,
    pub untracked_files: Vec<String>,
    pub modified_files: Vec<String>,
    pub staged_files: Vec<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Serialize)]
pub struct GitCommit {
    pub id: String,
    pub message: String,
    pub summary: String,
    pub author: String,
    pub author_email: String,
    pub committer: String,
    pub committer_email: String,
    pub date: String,
    pub time: i64,
    pub parent_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

pub fn get_git_status(repo_path: &str) -> Result<GitStatus, String> {
    let repo = match Repository::open(repo_path) {
        Ok(repo) => repo,
        Err(_) => return Err("Not a git repository".to_string()),
    };

    // Get current branch
    let branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(|s| s.to_string()));

    // Get status
    let mut status_opts = StatusOptions::new();
    status_opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut status_opts)).map_err(|e| e.to_string())?;

    let mut untracked = Vec::new();
    let mut modified = Vec::new();
    let mut staged = Vec::new();
    let mut is_dirty = false;

    for entry in statuses.iter() {
        let status = entry.status();
        if let Some(path) = entry.path() {
            if status.is_wt_new() {
                untracked.push(path.to_string());
                is_dirty = true;
            }
            if status.is_wt_modified() {
                modified.push(path.to_string());
                is_dirty = true;
            }
            if status.is_index_new() || status.is_index_modified() || status.is_index_deleted() {
                staged.push(path.to_string());
                is_dirty = true;
            }
        }
    }

    // Get ahead/behind info
    let (ahead, behind) = if let (Some(head), Some(upstream)) = (repo.head().ok(), repo.find_branch("origin/main", BranchType::Remote).ok()) {
        let local_oid = head.target().unwrap();
        let upstream_oid = upstream.get().target().unwrap();
        repo.graph_ahead_behind(local_oid, upstream_oid).unwrap_or((0, 0))
    } else {
        (0, 0)
    };

    Ok(GitStatus {
        branch,
        is_dirty,
        untracked_files: untracked,
        modified_files: modified,
        staged_files: staged,
        ahead,
        behind,
    })
}

pub fn commit_changes(repo_path: &str, message: &str) -> Result<GitCommit, String> {
    // Convert repo_path to a Path for any path manipulation if needed
    let repo = Repository::open(Path::new(repo_path)).map_err(|e| e.to_string())?;
    
    // Get the signature
    let sig = repo.signature().map_err(|e| e.to_string())?;
    
    // Get the index and write it to get the tree
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    
    // Get the current HEAD commit to use as parent
    let parent_commit = repo.head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|oid| repo.find_commit(oid).ok());
    
    // Create an array of parent commits
    let parents: Vec<&Commit> = parent_commit.as_ref().map_or_else(Vec::new, |c| vec![c]);
    
    // Create the commit
    let commit_id = match parents.as_slice() {
        [] => repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            message,
            &tree,
            &[],
        ),
        [parent] => repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            message,
            &tree,
            &[parent],
        ),
        _ => Err(git2::Error::from_str("Multiple parents not supported")),
    }.map_err(|e| e.to_string())?;
    
    // Create a GitCommit object with the commit details
    let commit = repo.find_commit(commit_id)
        .map_err(|e| e.to_string())?;
    
    // Get the committer signature
    let committer = commit.committer();
    
    // Format the date as a string using chrono
    let time = commit.time();
    let date = match Utc.timestamp_opt(time.seconds(), 0) {
        chrono::LocalResult::Single(dt) => dt.to_rfc2822(),
        _ => "Invalid date".to_string(),
    };
    
    // Extract the first line as summary
    let summary = message.lines().next().unwrap_or("").to_string();
    
    // Get parent IDs
    let parent_ids = (0..commit.parent_count())
        .filter_map(|i| commit.parent_id(i).ok())
        .map(|id| id.to_string())
        .collect();
    
    Ok(GitCommit {
        id: commit_id.to_string(),
        message: message.to_string(),
        summary,
        author: sig.name().unwrap_or("Unknown").to_string(),
        author_email: sig.email().unwrap_or("").to_string(),
        committer: committer.name().unwrap_or("Unknown").to_string(),
        committer_email: committer.email().unwrap_or("").to_string(),
        date,
        time: time.seconds(),
        parent_ids,
    })
}

pub fn get_branches(repo_path: &str) -> Result<Vec<GitBranch>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let mut branches = Vec::new();
    
    // Get local branches
    let local_branches = repo.branches(Some(BranchType::Local)).map_err(|e| e.to_string())?;
    for branch in local_branches {
        let (branch, _) = branch.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|_| "Invalid branch name".to_string())?
            .ok_or("Invalid branch name")?.to_string();
        
        let is_current = branch.is_head();
        branches.push(GitBranch {
            name,
            is_current,
            is_remote: false,
        });
    }
    
    // Get remote branches
    let remote_branches = repo.branches(Some(BranchType::Remote)).map_err(|e| e.to_string())?;
    for branch in remote_branches {
        let (branch, _) = branch.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|_| "Invalid branch name".to_string())?
            .ok_or("Invalid branch name")?.to_string();
        
        // Skip if this is a local branch that we've already added
        if !branches.iter().any(|b| b.name == name) {
            branches.push(GitBranch {
                name,
                is_current: false,
                is_remote: true,
            });
        }
    }
    
    Ok(branches)
}

pub fn checkout_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Check if it's a remote branch
    if branch_name.starts_with("origin/") {
        // Create a local tracking branch
        let remote_branch = repo.find_branch(branch_name, BranchType::Remote)
            .map_err(|_| format!("Remote branch {} not found", branch_name))?;
            
        let local_branch_name = branch_name.trim_start_matches("origin/");
        let commit = remote_branch.get().peel_to_commit()
            .map_err(|e| format!("Failed to find commit: {}", e))?;
            
        let branch = repo.branch(local_branch_name, &commit, false)
            .map_err(|e| format!("Failed to create local branch: {}", e))?;
            
        repo.set_head(branch.get().name().ok_or("Invalid branch name")?)
            .map_err(|e| e.to_string())?;
    } else {
        // It's a local branch
        let branch = repo.find_branch(branch_name, BranchType::Local)
            .map_err(|_| format!("Branch {} not found", branch_name))?;
            
        repo.set_head(branch.get().name().ok_or("Invalid branch name")?)
            .map_err(|e| e.to_string())?;
    }
    
    // Checkout the files
    let mut opts = git2::build::CheckoutBuilder::new();
    repo.checkout_head(Some(opts.force()))
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn create_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Get the current HEAD commit
    let head = repo.head().map_err(|e| e.to_string())?;
    let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
    
    // Create the new branch
    let _branch = repo.branch(branch_name, &commit, false)
        .map_err(|e| format!("Failed to create branch: {}", e))?;
    
    // Checkout the new branch
    let branch_ref = format!("refs/heads/{}", branch_name);
    repo.set_head(&branch_ref).map_err(|e| e.to_string())?;
    
    let mut opts = git2::build::CheckoutBuilder::new();
    repo.checkout_head(Some(opts.force()))
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn push_changes(repo_path: &str, remote_name: &str, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Find the remote
    let mut remote = repo.find_remote(remote_name)
        .map_err(|_| format!("Remote '{}' not found", remote_name))?;
    
    // Push the current branch
    let mut push_options = git2::PushOptions::new();
    remote.push(
        &[format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name)],
        Some(&mut push_options),
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn pull_changes(repo_path: &str, remote_name: &str, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    
    // Find the remote
    let mut remote = repo.find_remote(remote_name)
        .map_err(|_| format!("Remote '{}' not found", remote_name))?;
    
    // Fetch the latest changes
    remote.fetch(&[branch_name], None, None)
        .map_err(|e| format!("Failed to fetch: {}", e))?;
    
    // Get the FETCH_HEAD which points to the latest commit from the remote
    let fetch_head = repo.find_reference("FETCH_HEAD")
        .map_err(|e| format!("Failed to find FETCH_HEAD: {}", e))?;
    
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)
        .map_err(|e| format!("Failed to get commit from FETCH_HEAD: {}", e))?;
    
    // Get the current HEAD commit
    let _head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    
    // Do the merge analysis
    let analysis = repo.merge_analysis(&[&fetch_commit])
        .map_err(|e| format!("Merge analysis failed: {}", e))?;
    
    // Do the appropriate merge
    if analysis.0.is_up_to_date() {
        return Ok(());
    } else if analysis.0.is_fast_forward() {
        // Fast-forward merge
        let refname = format!("refs/heads/{}", branch_name);
        let mut reference = repo.find_reference(&refname)
            .map_err(|e| format!("Failed to find reference {}: {}", refname, e))?;
            
        reference.set_target(fetch_commit.id(), "Fast-forward")
            .map_err(|e| format!("Failed to update reference: {}", e))?;
            
        repo.set_head(&refname)
            .map_err(|e| format!("Failed to set HEAD: {}", e))?;
            
        let mut checkout_builder = git2::build::CheckoutBuilder::new();
        repo.checkout_head(Some(checkout_builder.force()))
            .map_err(|e| format!("Failed to checkout HEAD: {}", e))?;
    } else {
        // Handle other merge cases (not implemented in this example)
        return Err("Merge required but not implemented".to_string());
    }
    
    Ok(())
}
