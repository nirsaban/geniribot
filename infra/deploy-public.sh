#!/usr/bin/env bash
# Publish Kesher on its own subdomain with HTTPS.
#   Usage: sudo bash infra/deploy-public.sh [domain]
#   Default domain: wabot.miltech.cloud
# Prereq: a DNS A record  <domain> -> this server's public IP.
# Idempotent & safe: backs up nginx.conf, validates before every reload.
set -euo pipefail

DOMAIN="${1:-wabot.miltech.cloud}"
EMAIL="nirsa11@gmail.com"
APP_PORT="4000"
NGINX_CONF="/root/miluim/nginx/nginx.conf"
NGINX_CONTAINER="yogev-nginx"
CERTBOT_CONF="/root/miluim/certbot/conf"
CERTBOT_WWW="/root/miluim/certbot/www"

log() { echo "[deploy $DOMAIN] $*"; }

# 1. DNS check
ip_here="$(curl -s --max-time 8 ifconfig.me || true)"
ip_dom="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
log "server IP ${ip_here:-?} | $DOMAIN -> ${ip_dom:-<no DNS>}"
[ -z "$ip_dom" ] && { echo "ERROR: $DOMAIN does not resolve. Add A record -> $ip_here." >&2; exit 1; }

# 2. App up?
curl -sf "http://localhost:${APP_PORT}/api/health" >/dev/null || {
  log "web not up on :$APP_PORT — starting"; bash /home/debian/kesher/start.sh; sleep 3;
}

backup() { local ts; ts="$(date +%Y%m%d-%H%M%S)"; sudo cp "$NGINX_CONF" "${NGINX_CONF}.bak-${DOMAIN}-${ts}"; log "backup -> ${NGINX_CONF}.bak-${DOMAIN}-${ts}"; }
reload() { sudo docker exec "$NGINX_CONTAINER" nginx -t && sudo docker exec "$NGINX_CONTAINER" nginx -s reload; }

# insert a block before the final } of the http{} block
insert_block() {
  local block="$1" tmp; tmp="$(mktemp)"; printf '%s\n' "$block" > "$tmp"
  sudo cat "$NGINX_CONF" > /tmp/kesher-nginx-src.conf
  python3 - "$tmp" <<'PY'
import sys
src="/tmp/kesher-nginx-src.conf"; block=open(sys.argv[1]).read()
lines=open(src).read().split("\n")
idx=max(i for i,l in enumerate(lines) if l.strip()=="}")
lines[idx:idx]=["",block,""]
open("/tmp/kesher-nginx-out.conf","w").write("\n".join(lines))
PY
  sudo cp /tmp/kesher-nginx-out.conf "$NGINX_CONF"; rm -f "$tmp" /tmp/kesher-nginx-*.conf
}

HTTP_ONLY="\
    # ---- ${DOMAIN} (Kesher) HTTP + ACME ----
    server {
        listen 80;
        server_name ${DOMAIN};
        location /.well-known/acme-challenge/ { root /var/www/certbot; }
        location / {
            proxy_pass http://172.22.0.1:${APP_PORT};
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }"

FULL="\
    # ---- ${DOMAIN} (Kesher) HTTP -> HTTPS + ACME ----
    server {
        listen 80;
        server_name ${DOMAIN};
        location /.well-known/acme-challenge/ { root /var/www/certbot; }
        location / { return 301 https://\$host\$request_uri; }
    }

    # ---- ${DOMAIN} (Kesher) HTTPS -> host :${APP_PORT} ----
    server {
        listen 443 ssl;
        http2 on;
        server_name ${DOMAIN};
        ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_session_cache shared:KesherSSL:10m;
        client_max_body_size 10M;
        location / {
            proxy_pass http://172.22.0.1:${APP_PORT};
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
            proxy_read_timeout 120s;
            proxy_send_timeout 120s;
        }
    }"

CERT="${CERTBOT_CONF}/live/${DOMAIN}/fullchain.pem"

if [ -f "$CERT" ]; then
  # Cert exists → ensure the full HTTPS config is present.
  if ! sudo grep -q "server_name ${DOMAIN};" "$NGINX_CONF"; then
    backup; insert_block "$FULL"; reload; log "HTTPS block added"
  else
    log "server block already present"
  fi
else
  # No cert yet → add HTTP+ACME block so certbot can validate.
  if ! sudo grep -q "server_name ${DOMAIN};" "$NGINX_CONF"; then
    backup; insert_block "$HTTP_ONLY"; reload; log "HTTP/ACME block added"
  fi
  log "requesting Let's Encrypt cert…"
  sudo docker run --rm \
    -v "${CERTBOT_CONF}:/etc/letsencrypt" -v "${CERTBOT_WWW}:/var/www/certbot" \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive
  # Replace the HTTP-only block with the full HTTP->HTTPS + HTTPS config.
  backup
  sudo cat "$NGINX_CONF" > /tmp/kesher-nginx-src.conf
  python3 - <<PY
import re
src="/tmp/kesher-nginx-src.conf"; text=open(src).read()
text=re.sub(r"\n\s*# ---- ${DOMAIN} \(Kesher\) HTTP \+ ACME ----.*?\n    \}\n", "\n", text, flags=re.S)
open("/tmp/kesher-nginx-out.conf","w").write(text)
PY
  sudo cp /tmp/kesher-nginx-out.conf "$NGINX_CONF"; rm -f /tmp/kesher-nginx-*.conf
  insert_block "$FULL"; reload; log "HTTPS enabled"
fi

log "DONE"
curl -s -o /dev/null -w "https://${DOMAIN}/ -> HTTP %{http_code}\n" "https://${DOMAIN}/" || true
