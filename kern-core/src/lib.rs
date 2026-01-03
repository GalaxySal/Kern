pub mod document;
pub mod search;
pub mod tailwind;
pub mod watcher;

pub use document::Document;
pub use search::{ContentMatch, search_content, search_files};
pub use tailwind::{
    TailwindCompletion, TailwindCompletions, TailwindWatcher, get_default_utilities, scan_css_files,
};
pub use watcher::ProjectWatcher;
