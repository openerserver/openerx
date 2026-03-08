#!/usr/bin/env bash
# OpenerX VM Setup Script
# Run as root on a fresh Ubuntu 22.04+ / Debian 12+ VM
set -euo pipefail

echo "=== OpenerX VM Setup ==="

# ── 1. System packages ──────────────────────────────────────────────

apt-get update
apt-get install -y curl unzip git nginx certbot python3-certbot-nginx sqlite3 jq

# ── 2. Install Bun runtime ──────────────────────────────────────────

if ! command -v bun &>/dev/null; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo 'export BUN_INSTALL="$HOME/.bun"' >> /etc/profile.d/bun.sh
  echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> /etc/profile.d/bun.sh
fi

echo "Bun version: $(bun --version)"

# ── 3. Create openerx user ──────────────────────────────────────────

if ! id openerx &>/dev/null; then
  useradd -r -m -d /opt/openerx -s /bin/bash openerx
fi

# ── 4. Deploy application ───────────────────────────────────────────

DEPLOY_DIR="/opt/openerx"
DATA_DIR="/opt/openerx/data"

mkdir -p "$DATA_DIR"
mkdir -p "$DEPLOY_DIR/logs"

# Copy application (assumes tarball at /tmp/openerx-release.tar.gz)
if [ -f /tmp/openerx-release.tar.gz ]; then
  tar -xzf /tmp/openerx-release.tar.gz -C "$DEPLOY_DIR"
  cd "$DEPLOY_DIR" && bun install --production
fi

chown -R openerx:openerx "$DEPLOY_DIR"

# ── 5. Environment file ─────────────────────────────────────────────

cat > /opt/openerx/.env <<'ENVEOF'
# OpenerX Environment Configuration
NODE_ENV=production

# Control Plane
PORT=4097
DATABASE_URL=/opt/openerx/data/openerx.db
JWT_SECRET=CHANGE_ME_TO_A_RANDOM_64_CHAR_SECRET

# BFF
BFF_PORT=4098
OPENCODE_URL=http://localhost:4096
CONTROL_PLANE_URL=http://localhost:4097
CORS_ORIGIN=https://your-domain.example.com

# Model Providers (set your API keys)
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
ENVEOF

chmod 600 /opt/openerx/.env
chown openerx:openerx /opt/openerx/.env

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Edit /opt/openerx/.env with your API keys and JWT secret"
echo "  2. Enable systemd services: systemctl enable openerx-{control-plane,bff,opencode}"
echo "  3. Start services: systemctl start openerx-control-plane openerx-bff"
echo "  4. Configure nginx: edit /etc/nginx/sites-available/openerx"
echo "  5. Enable SSL: certbot --nginx -d your-domain.example.com"
