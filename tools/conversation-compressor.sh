#!/bin/bash

# Conversation Compressor Script
# Compresses conversation.log to memory when approaching token limit

CONVERSATION_FILE="conversation.log"
MEMORY_FILE="MEMORY.md"
DAILY_DIR="memory"
TODAY=$(date +%Y-%m-%d)
MAX_TOKENS=120000
THRESHOLD=110000

# Check if conversation file exists
if [ ! -f "$CONVERSATION_FILE" ]; then
    echo "No conversation log found"
    exit 1
fi

# Get token count (approximate)
get_token_count() {
    if command -v tiktoken &> /dev/null; then
        python3 -c "
import tiktoken, sys
enc = tiktoken.get_encoding('cl100k_base')
content = open('conversation.log', 'r').read()
print(enc.encode(content).length)
"
    else
        # Fallback: count words as proxy
        wc -w "$CONVERSATION_FILE" | awk '{print $1}'
    fi
}

TOKEN_COUNT=$(get_token_count)

if [ "$TOKEN_COUNT" -lt "$THRESHOLD" ]; then
    echo "Conversation healthy (${TOKEN_COUNT} tokens)"
    exit 0
fi

echo "⚠️ Approaching token limit (${TOKEN_COUNT}/${MAX_TOKENS}). Compressing..."

# Extract recent meaningful content
python3 - << 'EOF'
import re
from datetime import datetime

with open('conversation.log', 'r') as f:
    content = f.read()

# Extract last 200 lines of meaningful content
lines = content.split('\n')
meaningful = []
for line in reversed(lines[-300:]):
    stripped = line.strip()
    if stripped and len(stripped) > 10:
        if not stripped.startswith('---') and not stripped.startswith('<!--'):
            meaningful.append(stripped)

meaningful_text = '\n'.join(meaningful[:30])
print(f"SUMMARY={meaningful_text}")
EOF

SUMMARY=$(python3 - << 'EOF'
import re
from datetime import datetime

with open('conversation.log', 'r') as f:
    content = f.read()

# Extract last 200 lines of meaningful content
lines = content.split('\n')
meaningful = []
for line in reversed(lines[-300:]):
    stripped = line.strip()
    if stripped and len(stripped) > 10:
        if not stripped.startswith('---') and not stripped.startswith('<!--'):
            meaningful.append(stripped)

meaningful_text = '\n'.join(meaningful[:30])
print(meaningful_text)
EOF
)

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

# Append to memory
cat >> "$MEMORY_FILE" << EOF
---
<!-- conversation-compression:$TIMESTAMP -->
**Conversation Summary (${TOKEN_COUNT} tokens compressed)**

$SUMMARY

*Compressed from conversation.log to maintain context window*
---

EOF

# Archive conversation
ARCHIVE="$DAILY_DIR/conversation-$(date +%s).log"
mv "$CONVERSATION_FILE" "$ARCHIVE"

# Create empty conversation file
touch "$CONVERSATION_FILE"

echo "Compressed and archived. ${TOKEN_COUNT} tokens moved to memory."

# Update heartbeat state
if [ -f "$DAILY_DIR/heartbeat-state.json" ]; then
    python3 - << 'EOF'
import json, sys
from datetime import datetime

path = 'memory/heartbeat-state.json'
try:
    with open(path, 'r') as f:
        data = json.load(f)
    data['lastConversationClear'] = datetime.utcnow().isoformat() + 'Z'
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print("Updated heartbeat state")
except:
    print("Could not update heartbeat state")
EOF
fi