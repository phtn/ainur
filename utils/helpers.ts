import fs from "fs/promises";
import os from "os";
import path from "path";

export const cleanupTempDir = async (tempDir: string): Promise<void> => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`Clean up complete: ${tempDir.split("/").pop()}`);
  } catch (error) {
    console.warn(`Failed to cleanup temporary directory ${tempDir}:`, error);
  }
};

export const createTempDir = async (dirname?: string): Promise<string> => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), dirname ?? "git-clone-"),
  );
  console.log(`Created temporary directory: ${tempDir}`);
  return tempDir;
};

export const formatBytes = (bytes: number): string => {
  const sizes: Array<string> = [
    "Bytes",
    "KB",
    "MB",
    "GB",
    "TB",
    "PB",
    "EB",
    "ZB",
    "YB",
  ];
  if (bytes === 0) return "0 Bytes";

  // Determine which unit to use
  const i: number = Math.floor(Math.log(bytes) / Math.log(1024));

  // Scale the value into that unit
  const value: number = bytes / Math.pow(1024, i);

  // Round to 2 decimal places
  const rounded: number = Math.round(value * 100) / 100;

  return `${rounded} ${sizes[i]}`;
};
