use ignore::WalkBuilder;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static TAILWIND_WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailwindCompletion {
    pub label: String,
    pub kind: String,   // "utility" | "custom" | "color" | "spacing"
    pub detail: String, // Description or CSS value
    pub insert_text: String,
    pub priority: i32, // Higher = shown first (custom vars get 1000+)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailwindCompletions {
    pub custom_properties: Vec<TailwindCompletion>,
    pub utilities: Vec<TailwindCompletion>,
    pub project_root: String,
}

pub fn parse_theme_block(css_content: &str) -> Vec<TailwindCompletion> {
    let mut completions = Vec::new();

    // Find @theme { ... } blocks
    let mut in_theme = false;
    let mut brace_count = 0;
    let mut theme_content = String::new();

    for line in css_content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("@theme") {
            in_theme = true;
            brace_count = 0;
        }

        if in_theme {
            for ch in line.chars() {
                if ch == '{' {
                    brace_count += 1;
                } else if ch == '}' {
                    brace_count -= 1;
                    if brace_count == 0 {
                        in_theme = false;
                    }
                }
            }
            theme_content.push_str(line);
            theme_content.push('\n');
        }
    }

    // Parse CSS custom properties from theme content
    for line in theme_content.lines() {
        let trimmed = line.trim();
        if let Some(colon_pos) = trimmed.find(':').filter(|_| trimmed.starts_with("--")) {
            let var_name = trimmed[..colon_pos].trim();
            let var_value = trimmed[colon_pos + 1..].trim().trim_end_matches(';');

            let class_name = var_name.trim_start_matches("--");

            let kind = if class_name.contains("color") || class_name.contains("bg") {
                "color"
            } else if class_name.contains("spacing") || class_name.contains("size") {
                "spacing"
            } else {
                "custom"
            };

            completions.push(TailwindCompletion {
                label: class_name.to_string(),
                kind: kind.to_string(),
                detail: format!("var({}) → {}", var_name, var_value),
                insert_text: class_name.to_string(),
                priority: 1000,
            });
        }
    }

    completions
}

pub fn scan_css_files(root: &Path) -> Vec<TailwindCompletion> {
    let mut all_completions = Vec::new();

    let walker = WalkBuilder::new(root)
        .hidden(false)
        .ignore(true)
        .git_ignore(true)
        .max_depth(Some(10))
        .build();

    for entry in walker.flatten() {
        let path = entry.path();
        if let Some(content) = std::fs::read_to_string(path)
            .ok()
            .filter(|_| path.is_file() && path.extension().is_some_and(|ext| ext == "css"))
        {
            let mut file_completions = parse_theme_block(&content);
            all_completions.append(&mut file_completions);
        }
    }

    all_completions
}

pub fn get_default_utilities() -> Vec<TailwindCompletion> {
    let utilities = vec![
        ("flex", "Display: flex", 100),
        ("inline-flex", "Display: inline-flex", 100),
        ("grid", "Display: grid", 100),
        ("inline-grid", "Display: inline-grid", 100),
        ("block", "Display: block", 100),
        ("inline-block", "Display: inline-block", 100),
        ("inline", "Display: inline", 100),
        ("hidden", "Display: none", 100),
        ("contents", "Display: contents", 100),
        ("flex-row", "Flex direction: row", 90),
        ("flex-col", "Flex direction: column", 90),
        ("flex-wrap", "Flex wrap: wrap", 90),
        ("flex-nowrap", "Flex wrap: nowrap", 90),
        ("flex-1", "Flex: 1 1 0%", 90),
        ("flex-auto", "Flex: 1 1 auto", 90),
        ("flex-none", "Flex: none", 90),
        ("grow", "Flex-grow: 1", 90),
        ("grow-0", "Flex-grow: 0", 90),
        ("shrink", "Flex-shrink: 1", 90),
        ("shrink-0", "Flex-shrink: 0", 90),
        (
            "grid-cols-1",
            "Grid template columns: repeat(1, minmax(0, 1fr))",
            85,
        ),
        (
            "grid-cols-2",
            "Grid template columns: repeat(2, minmax(0, 1fr))",
            85,
        ),
        (
            "grid-cols-3",
            "Grid template columns: repeat(3, minmax(0, 1fr))",
            85,
        ),
        (
            "grid-cols-4",
            "Grid template columns: repeat(4, minmax(0, 1fr))",
            85,
        ),
        (
            "grid-cols-6",
            "Grid template columns: repeat(6, minmax(0, 1fr))",
            85,
        ),
        (
            "grid-cols-12",
            "Grid template columns: repeat(12, minmax(0, 1fr))",
            85,
        ),
        ("col-span-1", "Grid column: span 1", 85),
        ("col-span-2", "Grid column: span 2", 85),
        ("col-span-full", "Grid column: 1 / -1", 85),
        ("justify-start", "Justify content: flex-start", 80),
        ("justify-center", "Justify content: center", 80),
        ("justify-end", "Justify content: flex-end", 80),
        ("justify-between", "Justify content: space-between", 80),
        ("justify-around", "Justify content: space-around", 80),
        ("items-start", "Align items: flex-start", 80),
        ("items-center", "Align items: center", 80),
        ("items-end", "Align items: flex-end", 80),
        ("items-stretch", "Align items: stretch", 80),
        ("p-0", "Padding: 0", 70),
        ("p-1", "Padding: 0.25rem", 70),
        ("p-2", "Padding: 0.5rem", 70),
        ("p-3", "Padding: 0.75rem", 70),
        ("p-4", "Padding: 1rem", 70),
        ("p-5", "Padding: 1.25rem", 70),
        ("p-6", "Padding: 1.5rem", 70),
        ("p-8", "Padding: 2rem", 70),
        ("px-4", "Padding left/right: 1rem", 70),
        ("py-2", "Padding top/bottom: 0.5rem", 70),
        ("pt-4", "Padding top: 1rem", 70),
        ("pb-4", "Padding bottom: 1rem", 70),
        ("pl-4", "Padding left: 1rem", 70),
        ("pr-4", "Padding right: 1rem", 70),
        ("m-0", "Margin: 0", 70),
        ("m-1", "Margin: 0.25rem", 70),
        ("m-2", "Margin: 0.5rem", 70),
        ("m-4", "Margin: 1rem", 70),
        ("m-auto", "Margin: auto", 70),
        ("mx-auto", "Margin left/right: auto", 70),
        ("my-4", "Margin top/bottom: 1rem", 70),
        ("mt-4", "Margin top: 1rem", 70),
        ("mb-4", "Margin bottom: 1rem", 70),
        ("ml-4", "Margin left: 1rem", 70),
        ("mr-4", "Margin right: 1rem", 70),
        ("gap-1", "Gap: 0.25rem", 70),
        ("gap-2", "Gap: 0.5rem", 70),
        ("gap-4", "Gap: 1rem", 70),
        ("gap-6", "Gap: 1.5rem", 70),
        ("gap-8", "Gap: 2rem", 70),
        ("w-full", "Width: 100%", 65),
        ("w-auto", "Width: auto", 65),
        ("w-screen", "Width: 100vw", 65),
        ("w-1/2", "Width: 50%", 65),
        ("w-1/3", "Width: 33.333%", 65),
        ("w-1/4", "Width: 25%", 65),
        ("h-full", "Height: 100%", 65),
        ("h-auto", "Height: auto", 65),
        ("h-screen", "Height: 100vh", 65),
        ("min-h-screen", "Min height: 100vh", 65),
        ("max-w-sm", "Max width: 24rem", 65),
        ("max-w-md", "Max width: 28rem", 65),
        ("max-w-lg", "Max width: 32rem", 65),
        ("max-w-xl", "Max width: 36rem", 65),
        ("text-xs", "Font size: 0.75rem", 60),
        ("text-sm", "Font size: 0.875rem", 60),
        ("text-base", "Font size: 1rem", 60),
        ("text-lg", "Font size: 1.125rem", 60),
        ("text-xl", "Font size: 1.25rem", 60),
        ("text-2xl", "Font size: 1.5rem", 60),
        ("text-3xl", "Font size: 1.875rem", 60),
        ("font-thin", "Font weight: 100", 60),
        ("font-light", "Font weight: 300", 60),
        ("font-normal", "Font weight: 400", 60),
        ("font-medium", "Font weight: 500", 60),
        ("font-semibold", "Font weight: 600", 60),
        ("font-bold", "Font weight: 700", 60),
        ("italic", "Font style: italic", 60),
        ("not-italic", "Font style: normal", 60),
        ("uppercase", "Text transform: uppercase", 60),
        ("lowercase", "Text transform: lowercase", 60),
        ("capitalize", "Text transform: capitalize", 60),
        ("truncate", "Text overflow: ellipsis", 60),
        ("text-left", "Text align: left", 60),
        ("text-center", "Text align: center", 60),
        ("text-right", "Text align: right", 60),
        ("text-white", "Color: white", 55),
        ("text-black", "Color: black", 55),
        ("text-gray-500", "Color: gray-500", 55),
        ("text-gray-700", "Color: gray-700", 55),
        ("text-red-500", "Color: red-500", 55),
        ("text-blue-500", "Color: blue-500", 55),
        ("text-green-500", "Color: green-500", 55),
        ("bg-white", "Background: white", 55),
        ("bg-black", "Background: black", 55),
        ("bg-gray-100", "Background: gray-100", 55),
        ("bg-gray-200", "Background: gray-200", 55),
        ("bg-gray-800", "Background: gray-800", 55),
        ("bg-gray-900", "Background: gray-900", 55),
        ("bg-blue-500", "Background: blue-500", 55),
        ("bg-transparent", "Background: transparent", 55),
        ("border", "Border: 1px solid", 50),
        ("border-0", "Border: 0", 50),
        ("border-2", "Border: 2px solid", 50),
        ("border-t", "Border top: 1px solid", 50),
        ("border-b", "Border bottom: 1px solid", 50),
        ("border-l", "Border left: 1px solid", 50),
        ("border-r", "Border right: 1px solid", 50),
        ("border-gray-200", "Border color: gray-200", 50),
        ("border-gray-300", "Border color: gray-300", 50),
        ("rounded", "Border radius: 0.25rem", 50),
        ("rounded-md", "Border radius: 0.375rem", 50),
        ("rounded-lg", "Border radius: 0.5rem", 50),
        ("rounded-xl", "Border radius: 0.75rem", 50),
        ("rounded-full", "Border radius: 9999px", 50),
        ("rounded-none", "Border radius: 0", 50),
        ("shadow", "Box shadow: default", 45),
        ("shadow-sm", "Box shadow: small", 45),
        ("shadow-md", "Box shadow: medium", 45),
        ("shadow-lg", "Box shadow: large", 45),
        ("shadow-xl", "Box shadow: extra large", 45),
        ("shadow-none", "Box shadow: none", 45),
        ("opacity-0", "Opacity: 0", 45),
        ("opacity-50", "Opacity: 0.5", 45),
        ("opacity-100", "Opacity: 1", 45),
        ("relative", "Position: relative", 40),
        ("absolute", "Position: absolute", 40),
        ("fixed", "Position: fixed", 40),
        ("sticky", "Position: sticky", 40),
        ("static", "Position: static", 40),
        ("inset-0", "Top/Right/Bottom/Left: 0", 40),
        ("top-0", "Top: 0", 40),
        ("right-0", "Right: 0", 40),
        ("bottom-0", "Bottom: 0", 40),
        ("left-0", "Left: 0", 40),
        ("z-0", "Z-index: 0", 40),
        ("z-10", "Z-index: 10", 40),
        ("z-50", "Z-index: 50", 40),
        ("overflow-auto", "Overflow: auto", 35),
        ("overflow-hidden", "Overflow: hidden", 35),
        ("overflow-scroll", "Overflow: scroll", 35),
        ("overflow-visible", "Overflow: visible", 35),
        ("overflow-x-auto", "Overflow-x: auto", 35),
        ("overflow-y-auto", "Overflow-y: auto", 35),
        ("cursor-pointer", "Cursor: pointer", 30),
        ("cursor-default", "Cursor: default", 30),
        ("cursor-not-allowed", "Cursor: not-allowed", 30),
        ("pointer-events-none", "Pointer events: none", 30),
        ("pointer-events-auto", "Pointer events: auto", 30),
        ("select-none", "User select: none", 30),
        ("select-all", "User select: all", 30),
        ("transition", "Transition: all 150ms", 25),
        ("transition-colors", "Transition: colors 150ms", 25),
        ("transition-opacity", "Transition: opacity 150ms", 25),
        ("transition-transform", "Transition: transform 150ms", 25),
        ("duration-150", "Duration: 150ms", 25),
        ("duration-300", "Duration: 300ms", 25),
        ("duration-500", "Duration: 500ms", 25),
        ("ease-in", "Timing: ease-in", 25),
        ("ease-out", "Timing: ease-out", 25),
        ("ease-in-out", "Timing: ease-in-out", 25),
        ("scale-100", "Scale: 1", 20),
        ("scale-105", "Scale: 1.05", 20),
        ("scale-110", "Scale: 1.1", 20),
        ("rotate-45", "Rotate: 45deg", 20),
        ("rotate-90", "Rotate: 90deg", 20),
        ("rotate-180", "Rotate: 180deg", 20),
        ("translate-x-1", "Translate X: 0.25rem", 20),
        ("translate-y-1", "Translate Y: 0.25rem", 20),
        ("hover:bg-gray-100", "On hover: bg-gray-100", 15),
        ("hover:text-blue-500", "On hover: text-blue-500", 15),
        ("focus:outline-none", "On focus: no outline", 15),
        ("focus:ring-2", "On focus: ring-2", 15),
        ("active:scale-95", "On active: scale 95%", 15),
        ("dark:bg-gray-800", "Dark mode: bg-gray-800", 10),
        ("dark:text-white", "Dark mode: text-white", 10),
    ];

    utilities
        .into_iter()
        .map(|(label, detail, priority)| TailwindCompletion {
            label: label.to_owned(),
            kind: "utility".to_owned(),
            detail: detail.to_owned(),
            insert_text: label.to_owned(),
            priority,
        })
        .collect()
}

pub struct TailwindWatcher {
    pub receiver: std::sync::mpsc::Receiver<notify::Result<notify::Event>>,
    _watcher: RecommendedWatcher,
}

impl TailwindWatcher {
    pub fn new(root: &str) -> Result<Self, String> {
        let (tx, rx) = std::sync::mpsc::channel();
        let config = Config::default().with_poll_interval(Duration::from_secs(1));

        let mut watcher: RecommendedWatcher = Watcher::new(tx, config)
            .map_err(|e| format!("Failed to create Tailwind watcher: {}", e))?;

        watcher
            .watch(Path::new(root), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {}", e))?;

        TAILWIND_WATCHER_ACTIVE.store(true, Ordering::SeqCst);

        Ok(Self {
            receiver: rx,
            _watcher: watcher,
        })
    }

    pub fn stop() {
        TAILWIND_WATCHER_ACTIVE.store(false, Ordering::SeqCst);
    }

    pub fn is_active() -> bool {
        TAILWIND_WATCHER_ACTIVE.load(Ordering::SeqCst)
    }
}
