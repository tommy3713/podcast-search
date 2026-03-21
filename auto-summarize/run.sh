#!/bin/bash
set -e

SCRIPT_DIR="/Users/haotangli/Desktop/Projects/podcast-search/auto-summarize"
PYTHON="/Users/haotangli/Desktop/Projects/podcast-search/openai-env/bin/python"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d_%H-%M).log"

mkdir -p "$LOG_DIR"

echo "=== $(date) ===" >> "$LOG_FILE"
cd "$SCRIPT_DIR"
"$PYTHON" main.py production >> "$LOG_FILE" 2>&1
echo "=== Done ===" >> "$LOG_FILE"
