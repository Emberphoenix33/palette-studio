#!/bin/bash
# Push local changes to VPS and restart.
# Run this from your Mac: bash deploy/update.sh YOUR_VPS_IP

set -e

VPS_IP="${1:?Usage: bash deploy/update.sh YOUR_VPS_IP}"
APP_DIR="/opt/palette-studio"

echo "==> Uploading files to $VPS_IP..."
rsync -avz --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
    /Users/kyleking/projects/palette-studio/ \
    root@"$VPS_IP":"$APP_DIR"/

echo "==> Updating service file..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scp "$SCRIPT_DIR/palette-studio.service" root@"$VPS_IP":/etc/systemd/system/palette-studio.service

echo "==> Restarting app on VPS..."
ssh root@"$VPS_IP" "
    cd $APP_DIR
    .venv/bin/pip install --quiet -r requirements.txt
    systemctl daemon-reload
    systemctl restart palette-studio
    systemctl status palette-studio --no-pager
"

echo ""
echo "==> Done! http://$VPS_IP"
