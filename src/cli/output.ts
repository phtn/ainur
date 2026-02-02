import pc from "picocolors";

export const out = {
  dim: (s: string) => process.stdout.write(pc.dim(s)),
  green: (s: string) => process.stdout.write(pc.green(s)),
  red: (s: string) => process.stdout.write(pc.red(s)),
  cyan: (s: string) => process.stdout.write(pc.cyan(s)),
  write: (s: string) => process.stdout.write(s),
  println: (s: string) => console.log(s),
  error: (s: string) => console.error(pc.red(s)),
};
