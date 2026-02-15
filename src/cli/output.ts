import pc from "picocolors";

export const out = {
  dim: (s: string) => process.stdout.write(pc.dim(s)),
  green: (s: string) => process.stdout.write(pc.green(s)),
  red: (s: string) => process.stdout.write(pc.red(s)),
  cyan: (s: string) => process.stdout.write(pc.cyan(s)),
  write: (s: string) => process.stdout.write(s),
  println: (s: string) => console.log(s),
  error: (s: string) => console.error(pc.red(s)),

  bold: (s: string) => process.stdout.write(pc.bold(s)),
  muted: (s: string) => process.stdout.write(pc.dim(s)),

  toolLine: (name: string, detail: string) =>
    process.stdout.write(pc.dim(`  ⚙ ${pc.reset(name)} ${detail}\n`)),
  successLine: (s: string) =>
    process.stdout.write(pc.green(`  ✓ ${s}\n`)),
  warnLine: (s: string) =>
    process.stdout.write(pc.yellow(`  ⚠ ${s}\n`)),

  clearLine: () => process.stdout.write("\r\x1b[K"),

  elapsed: (ms: number) =>
    process.stdout.write(pc.dim(` (${(ms / 1000).toFixed(1)}s)\n`)),

  spinner: {
    _id: null as ReturnType<typeof setInterval> | null,
    _frame: 0,
    start(msg?: string) {
      if (!process.stderr.isTTY) return;
      if (this._id) clearInterval(this._id);
      const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
      this._frame = 0;
      this._id = setInterval(() => {
        const f = frames[this._frame % frames.length];
        process.stderr.write(`\r${f}${msg ? ` ${msg}` : ""}`);
        this._frame++;
      }, 80);
    },
    stop(msg?: string) {
      if (this._id) clearInterval(this._id);
      this._id = null;
      if (!process.stderr.isTTY) return;
      process.stderr.write("\r\x1b[K");
      if (msg) process.stderr.write(`${msg}\n`);
    },
  },
};
