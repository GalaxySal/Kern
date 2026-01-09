use ropey::Rope;
use std::fmt;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DocumentError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to load file")]
    LoadError,
}

pub struct Document {
    text: Rope,
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for Document {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.text)
    }
}

impl Document {
    pub fn new() -> Self {
        Self { text: Rope::new() }
    }

    pub fn from_path<P: AsRef<Path>>(path: P) -> Result<Self, DocumentError> {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let text = Rope::from_reader(reader)?;
        Ok(Self { text })
    }

    // Create a viewing window (start line, end line)
    pub fn get_lines(&self, start: usize, end: usize) -> Vec<String> {
        let len_lines = self.text.len_lines();
        if start >= len_lines {
            return Vec::new();
        }
        let end = std::cmp::min(end, len_lines);

        // Ropey slices are efficient
        let mut lines = Vec::with_capacity(end - start);
        for i in start..end {
            lines.push(self.text.line(i).to_string());
        }
        lines
    }

    pub fn len_lines(&self) -> usize {
        self.text.len_lines()
    }
}
