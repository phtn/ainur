// Conversation Compressor - ES Module version
// Monitors conversation length and compresses to memory when approaching token limit

import { readFile, writeFile, appendFile, rename } from 'fs/promises';
import { join } from 'path';

const CONVERSATION_FILE = join(process.cwd(), 'conversation.log');
const MEMORY_FILE = join(process.cwd(), 'MEMORY.md');
const DAILY_DIR = join(process.cwd(), 'memory');
const MAX_TOKENS = 120000; // Safety margin below 128K
const COMPRESSION_THRESHOLD = 110000; // Start compressing at this point

export class ConversationCompressor {
  async getTokenCount() {
    try {
      const content = await readFile(CONVERSATION_FILE, 'utf-8');
      // Simple word count as proxy for tokens (conservative estimate)
      return content.split(/\s+/).filter(w => w.length > 0).length;
    } catch {
      return 0;
    }
  }
  
  async compressToMemory() {
    const content = await readFile(CONVERSATION_FILE, 'utf-8');
    const tokenCount = await this.getTokenCount();
    
    if (tokenCount < COMPRESSION_THRESHOLD) return;
    
    const summary = await this.extractSummary(content);
    const timestamp = new Date().toISOString();
    
    const memoryEntry = `---\n<!-- conversation-compression:${timestamp} -->\n**Conversation Summary (${tokenCount} tokens compressed)**\n\n${summary}\n\n*Compressed from conversation.log to maintain context window*\n---\n\n`;
    
    await appendFile(MEMORY_FILE, memoryEntry, 'utf-8');
    
    const archivePath = join(DAILY_DIR, `conversation-${Date.now()}.log`);
    await rename(CONVERSATION_FILE, archivePath);
    await writeFile(CONVERSATION_FILE, '', 'utf-8');
    
    console.log(`Compressed ${tokenCount} tokens to memory`);
  }
  
  async extractSummary(content) {
    const lines = content.split('\n');
    const summaryLines = [];
    
    // Extract meaningful lines from recent conversation
    const meaningfulPattern = /\b\w{3,}\b/g; // Words with 3+ letters
    
    for (const line of lines.slice(-200)) { // Last 200 lines only
      const stripped = line.trim();
      if (stripped.length > 15 && stripped.match(meaningfulPattern)) {
        if (!stripped.startsWith('---') && !stripped.startsWith('<!--')) {
          summaryLines.push(stripped);
        }
      }
    }
    
    return summaryLines.slice(0, 25).join('\n').substring(0, 2000);
  }
  
  async clearConversation() {
    await writeFile(CONVERSATION_FILE, '', 'utf-8');
    console.log('Conversation cleared');
  }
  
  async getStatus() {
    const tokens = await this.getTokenCount();
    const status = tokens > COMPRESSION_THRESHOLD ? `⚠️ Compressing (${tokens}/${MAX_TOKENS} tokens)` : `✅ Healthy (${tokens} tokens)`;
    return `**Conversation Status**: ${status}`;
  }
}

async function main() {
  const compressor = new ConversationCompressor();
  const action = process.argv[2];
  
  switch(action) {
    case 'status':
      console.log(await compressor.getStatus());
      break;
    case 'compress':
      await compressor.compressToMemory();
      console.log('Compression complete');
      break;
    case 'clear':
      await compressor.clearConversation();
      console.log('Conversation cleared');
      break;
    default:
      console.log('Usage: node conversation-compressor.js [status|compress|clear]');
  }
}

main().catch(console.error);