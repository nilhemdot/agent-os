#!/usr/bin/env node
if (process.argv.includes("--version")) console.log("env-agent 1.0.0");
else console.log(JSON.stringify({ declared: Boolean(process.env.M3_DECLARED), undeclared: Boolean(process.env.UNDECLARED_SECRET) }));
