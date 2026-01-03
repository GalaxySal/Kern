pub mod document;
pub mod search;
pub mod watcher;
pub mod tailwind;

pub use document::Document;
pub use search::{search_files, search_content, ContentMatch};
pub use watcher::ProjectWatcher;
pub use tailwind::{TailwindCompletion, TailwindCompletions, TailwindWatcher, scan_css_files, get_default_utilities};
