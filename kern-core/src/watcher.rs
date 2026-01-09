use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::time::Duration;

pub static WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

pub struct ProjectWatcher {
    pub receiver: Receiver<notify::Result<notify::Event>>,
    _watcher: RecommendedWatcher,
}

impl ProjectWatcher {
    pub fn new(root: &str) -> Result<Self, String> {
        let (tx, rx) = std::sync::mpsc::channel();
        let config = Config::default().with_poll_interval(Duration::from_secs(2));

        let mut watcher: RecommendedWatcher =
            Watcher::new(tx, config).map_err(|e| format!("Failed to create watcher: {}", e))?;

        watcher
            .watch(Path::new(root), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {}", e))?;

        WATCHER_ACTIVE.store(true, Ordering::SeqCst);

        Ok(Self {
            receiver: rx,
            _watcher: watcher,
        })
    }

    pub fn stop() {
        WATCHER_ACTIVE.store(false, Ordering::SeqCst);
    }

    pub fn is_active() -> bool {
        WATCHER_ACTIVE.load(Ordering::SeqCst)
    }
}
