#!/bin/bash
echo "Installing system dependencies for Kern (Tauri)..."
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
    ID=$ID
fi

if [[ "$ID" == "fedora" ]]; then
    echo "Detected Fedora Linux..."
    sudo dnf check-update
    sudo dnf install -y webkit2gtk4.1-devel \
        openssl-devel \
        curl \
        wget \
        file \
        gtk3-devel \
        libayatana-appindicator-gtk3-devel \
        librsvg2-devel \
        libsoup3-devel \
        javascriptcoregtk4.0-devel
        # Note: javascriptcoregtk4.1-devel might be part of webkit2gtk4.1-devel or named differently on some versions, checking fallbacks if needed.
        # usually 4.1 webkit includes jsc.
elif [[ "$ID" == "ubuntu" || "$ID" == "debian" || "$ID_LIKE" == *"debian"* ]]; then
    echo "Detected Debian/Ubuntu..."
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
else
    echo "Unsupported or undetected distribution: $ID"
    echo "Please install dependencies manually."
    exit 1
fi

echo "Dependencies installed. Please try running 'cargo check' or 'cargo tauri dev' again."
