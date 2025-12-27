#!/bin/bash
echo "Installing system dependencies for Kern (Tauri)..."
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev

echo "Dependencies installed. Please try running 'cargo check' or 'cargo tauri dev' again."
