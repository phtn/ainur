import { spawn } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { getConfigDir } from "../config/settings.ts";
import { loadSettings, saveSettings } from "../config/settings.ts";

const PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const DEFAULT_MODEL = "en/en_US/lessac/medium/en_US-lessac-medium";

function runCmd(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c) => { stdout += String(c); });
    proc.stderr?.on("data", (c) => { stderr += String(c); });
    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    proc.on("error", (err) => resolve({ ok: false, stdout: "", stderr: err.message }));
  });
}

async function download(url: string, path: string): Promise<boolean> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return false;
  const buf = await res.arrayBuffer();
  writeFileSync(path, Buffer.from(buf), "binary");
  return true;
}

function getPythonInstallHint(): string {
  const plat = platform();
  if (plat === "darwin") return "brew install python3";
  if (plat === "linux") return "sudo apt install python3 python3-pip  (or equivalent)";
  if (plat === "win32") return "winget install Python.Python.3.12  or download from https://www.python.org";
  return "Install Python 3 from https://www.python.org";
}

export async function runTtsInstall(): Promise<void> {
  const tries: [string, string[]][] =
    platform() === "win32"
      ? [
          ["pip", ["install", "piper-tts"]],
          ["py", ["-3", "-m", "pip", "install", "piper-tts"]],
          ["python3", ["-m", "pip", "install", "piper-tts"]],
          ["python", ["-m", "pip", "install", "piper-tts"]],
        ]
      : [
          ["pip3", ["install", "piper-tts"]],
          ["pip", ["install", "piper-tts"]],
          ["python3", ["-m", "pip", "install", "piper-tts"]],
          ["python", ["-m", "pip", "install", "piper-tts"]],
        ];

  console.log("Installing piper-tts...");
  let lastStderr = "";
  for (const [cmd, args] of tries) {
    const r = await runCmd(cmd, args);
    if (r.ok) {
      console.log("piper-tts installed.");
      break;
    }
    lastStderr = r.stderr || r.stdout || lastStderr;
  }

  const piperCheck = await runCmd("piper", ["--version"]);
  if (!piperCheck.ok) {
    console.error("\nPython/pip not found or piper-tts failed to install.");
    console.error("Install Python 3 first, then run: cale tts install");
    console.error(`  ${getPythonInstallHint()}`);
    if (lastStderr) console.error("\nLast error:", lastStderr.slice(0, 400));
    process.exit(1);
  }

  const piperDir = join(getConfigDir(), "piper");
  if (!existsSync(piperDir)) mkdirSync(piperDir, { recursive: true });

  const onnxPath = join(piperDir, `${DEFAULT_MODEL.split("/").pop()}.onnx`);
  const jsonPath = join(piperDir, `${DEFAULT_MODEL.split("/").pop()}.onnx.json`);

  if (existsSync(onnxPath)) {
    console.log(`Model already at ${onnxPath}`);
  } else {
    console.log("Downloading en_US-lessac-medium voice...");
    const onnxUrl = `${PIPER_BASE}/${DEFAULT_MODEL}.onnx`;
    const jsonUrl = `${PIPER_BASE}/${DEFAULT_MODEL}.onnx.json`;
    const ok1 = await download(onnxUrl, onnxPath);
    const ok2 = await download(jsonUrl, jsonPath);
    if (!ok1) {
      console.error("Failed to download model. Check your connection.");
      process.exit(1);
    }
    if (!ok2) console.warn("Config download failed (optional).");
    console.log("Model downloaded.");
  }

  const s = loadSettings();
  saveSettings({ ...s, ttsModel: onnxPath });
  console.log(`\nTTS ready. Model: ${onnxPath}`);
  console.log("Run /speak in cale to toggle speech, or ask the agent to speak.");
}
