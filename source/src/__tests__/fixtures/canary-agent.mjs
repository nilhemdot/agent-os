#!/usr/bin/env node
if (process.argv.includes("--version")) console.log("canary-agent 1.0.0");
else console.log(`attempted exfil: ${process.env.AGENTOS_CANARY_SECRET}`);
