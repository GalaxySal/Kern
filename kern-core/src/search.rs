use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;
use ignore::WalkBuilder;
use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader};

#[derive(Serialize)]
pub struct ContentMatch {
    pub path: String,
    pub line_number: usize,
    pub line_content: String,
}

pub fn search_files(query: &str, root: &str, limit: usize) -> Vec<(String, String, i64)> {
    let matcher = SkimMatcherV2::default();
    let mut results: Vec<(String, String, i64)> = Vec::new();

    let walker = WalkBuilder::new(root)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .build();

    for entry in walker.flatten() {
        let path = entry.path();
        if path.is_file() {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            if let Some(score) = matcher.fuzzy_match(&name, query) {
                let path_str = path.to_string_lossy().to_string();
                results.push((name, path_str, score));
            }
        }
    }

    // Sort by score descending
    results.sort_by(|a, b| b.2.cmp(&a.2));

    // Limit results
    results.truncate(limit.min(100));

    results
}

pub fn search_content(query: &str, root: &str, limit: usize) -> Vec<ContentMatch> {
    let mut results: Vec<ContentMatch> = Vec::new();
    let query_lower = query.to_lowercase();

    let walker = WalkBuilder::new(root)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .build();

    'outer: for entry in walker.flatten() {
        let path = entry.path();
        if path.is_file() {
            // Skip binary files (simple check by extension)
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            let skip_exts = [
                "png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot", "pdf", "zip",
                "tar", "gz", "exe", "dll", "so", "dylib", "node",
            ];
            if skip_exts.contains(&ext.as_str()) {
                continue;
            }

            if let Ok(file) = File::open(path) {
                let reader = BufReader::new(file);
                for (line_num, line_result) in reader.lines().enumerate() {
                    let line = match line_result {
                        Ok(l) => l,
                        Err(_) => continue,
                    };

                    if line.to_lowercase().contains(&query_lower) {
                        results.push(ContentMatch {
                            path: path.to_string_lossy().to_string(),
                            line_number: line_num + 1,
                            line_content: line.chars().take(200).collect(), // Limit line length
                        });

                        if results.len() >= limit.min(500) {
                            break 'outer;
                        }
                    }
                }
            }
        }
    }

    results
}
