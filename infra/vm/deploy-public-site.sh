#!/usr/bin/env bash
# Deploy the OpenerX public company homepage to the VM behind opener-x.com.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_HOST="${TARGET_HOST:-opener-x}"
REMOTE_WEB_ROOT="${REMOTE_WEB_ROOT:-/var/www/html}"
REMOTE_NGINX_SITE="${REMOTE_NGINX_SITE:-/etc/nginx/sites-available/investment}"

cd "$ROOT_DIR"

if [[ ! -f public-site/index.html ]]; then
  echo "public-site/index.html not found" >&2
  exit 1
fi

COPYFILE_DISABLE=1 tar --format ustar -C public-site -czf - . | ssh "$TARGET_HOST" "\
  mkdir -p '$REMOTE_WEB_ROOT' && \
  tar -xzf - -C '$REMOTE_WEB_ROOT'"

ssh "$TARGET_HOST" "cat > /tmp/openerx-public-site.nginx" < infra/vm/nginx-public-site.conf
ssh "$TARGET_HOST" "\
  cp '$REMOTE_NGINX_SITE' '$REMOTE_NGINX_SITE.bak-$(date +%Y%m%d-%H%M%S)' && \
  install -m 0644 /tmp/openerx-public-site.nginx '$REMOTE_NGINX_SITE' && \
  nginx -t && \
  systemctl reload nginx"

curl -kfsS --resolve opener-x.com:443:205.185.120.94 https://opener-x.com/ >/dev/null
curl -kfsS --resolve opener-x.com:443:205.185.120.94 https://opener-x.com/privacy.html >/dev/null
echo "Deployed public site to https://opener-x.com/"
