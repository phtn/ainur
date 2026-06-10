#!/usr/bin/env bash
set -euo pipefail

ensure_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  echo "Docker daemon not running. Starting it..."

  if command -v colima >/dev/null 2>&1; then
    colima start
  elif [[ "$OSTYPE" == darwin* ]] && [[ -d "/Applications/Docker.app" ]]; then
    open -a Docker
  elif command -v systemctl >/dev/null 2>&1; then
    sudo systemctl start docker
  else
    echo "No supported Docker runtime starter found."
    return 1
  fi

  for _ in {1..60}; do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Docker daemon did not become ready in time."
  return 1
}

rhasspy_up() {
  local script_dir root_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  root_dir="$(cd "${script_dir}/.." && pwd)"

  ensure_docker
  "${script_dir}/start_host_audio.sh"
  "${script_dir}/start_host_tts.sh"

  docker compose -f "${root_dir}/docker-compose.yml" stop voice-clone-tts >/dev/null 2>&1 || true

  if [[ "$#" -gt 0 ]]; then
    (
      cd "${root_dir}"
      docker compose up -d "$@"
    )
    return
  fi

  (
    cd "${root_dir}"
    docker compose up -d rhasspy sample-uploader
  )
}

rhasspy_up "$@"
