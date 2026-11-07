#!/usr/bin/env bash
# Investment Arena – Installation und Update auf einem Linux-Server (Ubuntu/Debian)
# Aufruf als root:  curl -fsSL https://raw.githubusercontent.com/flashmenandwockman/investment-arena/main/deploy/install.sh | bash
# Erneut ausführen = Update auf den neuesten Stand.
set -euo pipefail

REPO="https://github.com/flashmenandwockman/investment-arena.git"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/investment-arena}"
DOMAIN="www.investment-arena.com"

say() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen (sudo -i)."; exit 1; }

say "1/5 Docker prüfen"
if ! command -v docker >/dev/null 2>&1; then
  # Zuerst die Docker-Pakete der Distribution (funktioniert auch auf ganz neuen Ubuntu-Versionen),
  # sonst das offizielle Installationsskript von docker.com
  apt-get update -qq
  if ! DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
fi
docker compose version >/dev/null || { echo "docker compose fehlt"; exit 1; }

# Server-Firewall (ufw), falls aktiv: nur Webports freigeben, sonst nichts ändern
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  echo "ufw: Ports 80 und 443 freigegeben"
fi

say "2/5 Code holen ($BRANCH)"
command -v git >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq git)
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

say "3/5 Konfiguration (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  KEY=""
  if [ -t 0 ] || [ -e /dev/tty ]; then read -rp "Finnhub-Schlüssel (Enter = später eintragen): " KEY </dev/tty || true; fi
  sed -i "s|^FINNHUB_KEY=.*|FINNHUB_KEY=${KEY}|" .env
  echo ".env angelegt: $DIR/.env"
else
  echo ".env vorhanden, bleibt unverändert."
fi

say "4/5 Starten"
if ss -tlnH '( sport = :80 or sport = :443 )' | grep -q . && ! docker compose ps caddy 2>/dev/null | grep -q caddy; then
  echo "Ports 80/443 sind bereits durch einen anderen Webserver belegt."
  echo "→ Die Arena startet nur intern auf 127.0.0.1:8080."
  echo "→ Den vorhandenen Webserver auf die Arena verweisen lassen: siehe deploy/nginx-investment-arena.conf bzw. deploy/caddy-snippet.txt"
  docker compose up -d --build app
else
  docker compose up -d --build
fi

say "5/5 Prüfen"
for i in $(seq 1 30); do
  if curl -fs http://127.0.0.1:8080/healthz >/dev/null; then break; fi; sleep 2
done
curl -fs http://127.0.0.1:8080/healthz && echo
docker compose ps
echo
echo "Fertig. Sobald die DNS-Einträge auf diesen Server zeigen, ist die Arena unter https://$DOMAIN erreichbar."
echo "Logs ansehen:  cd $DIR && docker compose logs -f app"
