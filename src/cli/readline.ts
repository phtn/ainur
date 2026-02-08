import { createInterface, type Interface, type Completer } from "node:readline";

export type ReadlineInstance = Interface;

/**
 * Create readline interface.
 * Pass a completer function to enable tab completion.
 */
export function createReadline(completer?: Completer): ReadlineInstance {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer,
    historySize: 200,
    removeHistoryDuplicates: true,
  });
}
