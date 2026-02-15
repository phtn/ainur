#!/usr/bin/env bun

import { main } from "../src/index.ts";

main().catch((err) => {
  console.error("cale:", err instanceof Error ? err.message : err);
  process.exit(1);
});
