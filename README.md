# Kern Editor - Ultra-Lightweight Rust Code Editor

Kern is a high-performance, ultra-lightweight code editor built with **Rust**, **Tauri 2.0**, and **Monaco Editor**. It combines the power of native speed with the flexibility of modern web technologies to provide a premium development experience.

---

## 🧩 Key Features

### 1. Extension Marketplace
- **Secure by Design**: All extensions are verified via **SHA256 checksums** before installation.
- **Permission System**: Explicit user consent for file system, network, and terminal access.
- **Supabase Integration**: Backed by Supabase for real-time extension listings, ratings, and download counts.
- **Sandboxed Execution**: Sidecar path guards restrict native binary extensions to their own directories.

### 🎨 Tailwind v4 IntelliSense (Built-in)
- **CSS @theme Parser**: Automatically scans project CSS files for custom property definitions.
- **Real-time Monitoring**: Asynchronous file watcher (`notify`) updates completions the moment you save your CSS.
- **Monaco Provider**: Native autocompletion for `class` and `className` attributes with custom variable prioritization.

### 🔍 Advanced Search & Navigation
- **Command Palette (Ctrl+P)**: Fast, fuzzy search through thousands of files.
- **Content Grep**: High-speed content search powered by Rust's `grep-searcher`.
- **Project Watcher**: Automatically reflects file system changes in the explorer tree.

### 💻 Integrated Terminal
- Full-featured terminal emulator using `portable-pty` and `xterm.js`.
- Tabbed interface with session management.

---

## 🛠️ Technical Stack

- **Backend**: Rust, Tauri 2.0, Tokio (Async Runtime)
- **Frontend**: Vanilla JS (ES6+), Tailwind CSS v4 (Glassmorphism UI)
- **Editor Core**: Monaco Editor
- **Database**: Supabase (Backend-as-a-Service)
- **Dependencies**: `sha2`, `zip-rs`, `notify`, `walkdir`, `portable-pty`, `serde`

---

## 🚀 Getting Started

### Prerequisites
- **Rust** (latest stable)
- **Node.js** (v20+)
- **OS Dependencies** (Linux):
  ```bash
  sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```

### Running for Development
```bash
# Clone and enter directory
cd kern

# Install UI dependencies
cd ui && npm install

# Run the app in development mode
npm run tauri dev
```

---

## ⌨️ Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + P` | Command Palette (Search Files) |
| `Ctrl + Shift + X` | Extensions Marketplace |
| `Ctrl + S` | Save File |
| `Ctrl + ` ` (Backtick) | Toggle Terminal |
| `Ctrl + \` | Toggle Sidebar |

---

## 🌐 Marketplace & Supabase Setup

Kern uses Supabase to manage its marketplace. To set up your own instance:

1. Create a `extensions` table with the following fields:
   - `id`, `name`, `version`, `author_name`, `download_url`, `checksum_sha256`, `permissions` (JSONB), `tags` (JSONB).
2. Enable **Row Level Security (RLS)** to allow public reads and restricted writes.
3. Configure your `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `src-tauri/src/extension_manager.rs`.

---

## 📦 Project Structure

- `kern-core/`: Optimized text manipulation and data structures.
- `src-tauri/`: Native Rust commands and application logic.
  - `extension_manager.rs`: Secure download and lifecycle management.
  - `tailwind_ext.rs`: CSS parsing and IntelliSense engine.
- `ui/`: Frontend implementation with a focus on modern aesthetics (Backdrop blur, HSL gradients).

---

## 🤝 Contributing

We welcome community contributions! You can publish your own extensions by clicking the **➕ Publish Extension** button in the Marketplace and following the instructions.

**Kern Editor** - *Code faster, wait less.*

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

