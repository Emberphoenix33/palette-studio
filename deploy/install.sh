#!/bin/bash
# Run this on the VPS after uploading files, and again after each update.
# Usage: bash /opt/palette-studio/deploy/install.sh

set -e

APP_DIR="/opt/palette-studio"
APP_USER="palette"
GUNICORN_PORT=5050

echo "==> Installing Python dependencies..."
cd "$APP_DIR"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

echo "==> Setting permissions..."
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Installing systemd service..."
cp "$APP_DIR/deploy/palette-studio.service" /etc/systemd/system/palette-studio.service
systemctl daemon-reload
systemctl enable palette-studio
systemctl restart palette-studio

echo "==> Installing nginx config..."
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/palette-studio
ln -sf /etc/nginx/sites-available/palette-studio /etc/nginx/sites-enabled/palette-studio
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "==> Done! App is running."
systemctl status palette-studio --no-pager
echo ""
echo "Open in browser: http://$(curl -s ifconfig.me)"
