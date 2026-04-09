import fs from "fs/promises";
import { execSync } from "child_process";
import { createTempDir } from "./helpers";

export const isGitHubUrl = (input: string): boolean => {
  const githubUrlPattern =
    /^https:\/\/github\.com\/[^]+\/[^]+(?:\.git)?(?:\/.*)?$/;
  const githubSshPattern = /^git@github\.com:[^]+\/[^]+(?:\.git)?$/;
  return githubUrlPattern.test(input) || githubSshPattern.test(input);
};

const normalizeGitHubUrl = (url: string): string => {
  // Convert SSH to HTTPS format
  if (url.startsWith("git@github.com:")) {
    const repoPath = url.replace("git@github.com:", "").replace(".git", "");
    return `https://github.com/${repoPath}.git`;
  }

  // Ensure .git suffix for HTTPS URLs
  if (url.includes("github.com") && !url.endsWith(".git")) {
    // Remove any trailing slash and branch/path info
    const urlTree = url.split("/tree/");
    const baseUrl =
      Array.isArray(urlTree) && urlTree.length > 0
        ? urlTree[0]!.split("/blob/")[0]
        : url;
    return `${baseUrl}.git`;
  }

  return url;
};

export const cloneGitHubRepo = async (repoUrl: string): Promise<string> => {
  const tempDir = await createTempDir("code-analyzer-");
  const normalizedUrl = normalizeGitHubUrl(repoUrl);

  try {
    console.log(`Cloning repository: ${normalizedUrl}`);
    execSync(`git clone "${normalizedUrl}" "${tempDir}"`, {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    return tempDir;
  } catch (error) {
    // Cleanup on failure
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(cleanupError);
      // Ignore cleanup errors
    }

    if (error instanceof Error) {
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
    throw new Error("Failed to clone repository: Unknown error");
  }
};
