#!/bin/bash
# Run this ONCE on a fresh Hostinger Ubuntu 22.04 VPS (as root).
# Usage: bash setup.sh

set -e

APP_NAME="palette-studio"
APP_DIR="/opt/palette-studio"
APP_USER="palette"
GUNICORN_PORT=5050

echo "==> Updating system packages..."
apt-get update -q && apt-get upgrade -y -q

echo "==> Installing dependencies..."
apt-get install -y -q python3 python3-pip python3-venv nginx git

echo "==> Creating app user (no login shell)..."
id -u "$APP_USER" &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"

echo "==> Creating app directory..."
mkdir -p "$APP_DIR"
chown "$APP_USER":"$APP_USER" "$APP_DIR"

echo ""
echo "==========================================="
echo "  NEXT: upload your app files to $APP_DIR"
echo "  Then run: bash /opt/palette-studio/deploy/install.sh"
echo "==========================================="
echo ""
echo "To upload files from your Mac, run this locally:"
echo "  scp -r /Users/kyleking/projects/palette-studio/* root@YOUR_VPS_IP:$APP_DIR/"
