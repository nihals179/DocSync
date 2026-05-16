#!/usr/bin/env bash
set -euo pipefail

PG_SERVICE_NAME="${PG_SERVICE_NAME:-postgresql}"
REDIS_SERVICE_NAME="${REDIS_SERVICE_NAME:-redis}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
INSTALL_MISSING="${INSTALL_MISSING:-true}"

install_postgresql_if_missing() {
  if command -v pg_isready >/dev/null 2>&1; then
    return
  fi
  if [[ "${INSTALL_MISSING}" != "true" ]]; then
    echo "WARNING: PostgreSQL tools not found and INSTALL_MISSING=false"
    return
  fi

  echo "Installing PostgreSQL tools..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y postgresql postgresql-client
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y postgresql-server postgresql
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y postgresql-server postgresql
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm postgresql
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y postgresql postgresql-server
  elif command -v brew >/dev/null 2>&1; then
    brew install postgresql@16
  else
    echo "WARNING: No supported package manager found for PostgreSQL install."
  fi
}

install_redis_if_missing() {
  if command -v redis-cli >/dev/null 2>&1; then
    return
  fi
  if [[ "${INSTALL_MISSING}" != "true" ]]; then
    echo "WARNING: Redis tools not found and INSTALL_MISSING=false"
    return
  fi

  echo "Installing Redis..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y redis-server
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y redis
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y redis
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm redis
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y redis
  elif command -v brew >/dev/null 2>&1; then
    brew install redis
  else
    echo "WARNING: No supported package manager found for Redis install."
  fi
}

echo "[0/4] Ensuring PostgreSQL and Redis are installed..."
install_postgresql_if_missing
install_redis_if_missing

echo "[1/4] Starting PostgreSQL service: ${PG_SERVICE_NAME}"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl start "${PG_SERVICE_NAME}" || echo "WARNING: Failed to start ${PG_SERVICE_NAME} via systemctl"
elif command -v service >/dev/null 2>&1; then
  sudo service "${PG_SERVICE_NAME}" start || echo "WARNING: Failed to start ${PG_SERVICE_NAME} via service"
else
  echo "WARNING: No service manager detected (systemctl/service)."
fi

echo "[2/4] Starting Redis service: ${REDIS_SERVICE_NAME}"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl start "${REDIS_SERVICE_NAME}" || echo "WARNING: Failed to start ${REDIS_SERVICE_NAME} via systemctl"
elif command -v service >/dev/null 2>&1; then
  sudo service "${REDIS_SERVICE_NAME}" start || echo "WARNING: Failed to start ${REDIS_SERVICE_NAME} via service"
elif command -v redis-server >/dev/null 2>&1; then
  redis-server --daemonize yes || echo "WARNING: Failed to start redis-server in daemon mode"
else
  echo "WARNING: Redis service manager and redis-server not found."
fi

echo "[3/4] Checking PostgreSQL health..."
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h 127.0.0.1 -p 5432 || true
else
  echo "WARNING: pg_isready not found in PATH. Skipping PostgreSQL health check."
fi

echo "[4/4] Checking Redis health..."
if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -u "${REDIS_URL}" ping || true
else
  echo "WARNING: redis-cli not found in PATH. Skipping Redis health check."
fi

echo "Tip: Set INSTALL_MISSING=false to skip package installation attempts."
echo "Done."
