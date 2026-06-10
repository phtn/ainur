#!/usr/bin/env bash
set -euo pipefail

# Simple rhasspy wrapper to avoid port 8080 conflict
# Usage: ./rhasspy_wrapper.sh {start|stop}

# Get project root (script is in ~/Code/rhasspy/scripts/, project is in ~/Code/rhasspy)
PROJECT_ROOT="$(dirname "$(dirname "$(pwd)")")"
ACTION="$1"

if [ -z "$ACTION" ]; then
    echo "Usage: $0 {start|stop}"
    echo "  start - Start rhasspy with port 8081 override"
    echo "  stop  - Stop rhasspy and restore original config"
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/docker-compose.yml" ]; then
    echo "Error: docker-compose.yml not found in $PROJECT_ROOT"
    exit 1
fi

COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
BACKUP_FILE="$COMPOSE_FILE.backup"

if [ "$ACTION" = "start" ]; then
    echo "Starting rhasspy with port 8081 override..."
    
    # Backup original compose file
    cp "$COMPOSE_FILE" "$BACKUP_FILE"
    
    # Modify port mapping (8080:8080 -> 8081:8080)
    sed -i '' "s/\"8080:8080\"/\"8081:8080\"/" "$COMPOSE_FILE"
    
    # Ensure Docker is running
    if ! docker info >/dev/null 2>&1; then
        echo "Docker not running. Starting colima..."
        if command -v colima >/dev/null 2>&1; then
            colima start
        else
            echo "colima not found. Please install colima."
            exit 1
        fi
    fi
    
    # Start containers
    (cd "$PROJECT_ROOT" && docker compose up -d rhasspy sample-uploader)
    echo "Rhasspy started on port 8081"
    
elif [ "$ACTION" = "stop" ]; then
    echo "Stopping rhasspy containers..."
    if docker ps | grep -q "rhasspy"; then
        (cd "$PROJECT_ROOT" && docker compose down)
    fi
    
    # Restore original compose file if backup exists
    if [ -f "$BACKUP_FILE" ]; then
        cp "$BACKUP_FILE" "$COMPOSE_FILE"
        rm -f "$BACKUP_FILE"
        echo "Restored original docker-compose.yml"
    fi
else
    echo "Error: Invalid action '$ACTION'"
    echo "Usage: $0 {start|stop}"
    exit 1
fi
