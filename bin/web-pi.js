#!/usr/bin/env node
// Nothing here but the entry point: dist/cli.js parses the flags, links the
// Pi SDK, and starts dist/server.js.
import { run } from "../dist/cli.js";

await run(process.argv.slice(2));
