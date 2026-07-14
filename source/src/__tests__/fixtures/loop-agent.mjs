#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("loop-agent 1.0.0");
  process.exit(0);
}
let attempt = 10000;
setInterval(() => console.log(JSON.stringify({ type: "tool_use", name: "search", input: { query: "same request", attempt: attempt++ } })), 10);
