import { createInterface } from "node:readline";

/**
 * Create readline interface with terminal: false to prevent character duplication
 * on some terminals (e.g. Bun, certain TTY setups).
 */
export function createReadline() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
}
