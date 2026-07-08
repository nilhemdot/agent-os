// Curated list of popular MCP servers outside the Nous-approved catalogue.
// These are well-known servers from @modelcontextprotocol/* and the wider
// ecosystem. Each preset pre-fills the AddCustomModal so a user can install
// in one click without looking up the package name + args.
//
// Adding a new preset = one entry in this array. Keep it short and battle-
// tested — random GitHub MCPs that haven't been vetted shouldn't be here.
//
// We deliberately don't use the `hermes mcp add --preset` flag here (it only
// knows `codex`); instead we ship full command/args/env defaults so each
// preset is self-describing and we can offer many more than the CLI bundles.

export interface McpPreset {
  id: string;
  name: string;          // suggested config name (lowercased, hyphenless)
  description: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  // Env vars the user needs to provide. Mark secret:true so the modal renders
  // a password input. argHint surfaces hints like "<filesystem path>".
  envVars?: Array<{ name: string; prompt: string; secret?: boolean; default?: string }>;
  argHint?: string;
  // Docs/homepage URL for the trust panel.
  source?: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "github",
    name: "github",
    description: "Read/write GitHub issues, PRs, code search, repos.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envVars: [
      { name: "GITHUB_PERSONAL_ACCESS_TOKEN", prompt: "GitHub PAT (settings → developer settings → tokens)", secret: true },
    ],
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
  {
    id: "filesystem",
    name: "filesystem",
    description: "Read + write files under a single allowlisted directory.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}/projects"],
    argHint: "Last arg is the allowlisted path — edit it before installing.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "memory",
    name: "memory",
    description: "Knowledge-graph memory — persistent facts the agent can store + recall.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "puppeteer",
    name: "puppeteer",
    description: "Headless Chrome — navigate, click, screenshot, scrape.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
  },
  {
    id: "brave-search",
    name: "brave-search",
    description: "Web search via the Brave Search API.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envVars: [
      { name: "BRAVE_API_KEY", prompt: "Brave Search API key (free tier available)", secret: true },
    ],
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
  },
  {
    id: "postgres",
    name: "postgres",
    description: "Postgres MCP — query schemas + run read-only SQL.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
    argHint: "Edit the connection string before installing.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
  },
  {
    id: "slack",
    name: "slack",
    description: "Read channels, post messages, list users.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envVars: [
      { name: "SLACK_BOT_TOKEN", prompt: "Slack bot token (xoxb-…)", secret: true },
      { name: "SLACK_TEAM_ID", prompt: "Slack team/workspace ID (T...)", secret: false },
    ],
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
  },
  {
    id: "gmail",
    name: "gmail",
    description: "Read, search, label, draft & send Gmail (full Gmail API). Vetted, OAuth-based (scoped token, no password stored). Needs a one-time Google sign-in — see setup.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
    // Auth is a one-time OAuth flow (not an env key): place gcp-oauth.keys.json in
    // ~/.gmail-mcp/ then run `npx @gongrzhe/server-gmail-autoauth-mcp auth`. The
    // browser sign-in stores a scoped token; install this preset afterwards.
    argHint: "Before installing: run the one-time Google OAuth (see the Gmail setup steps).",
    source: "https://github.com/GongRzhe/Gmail-MCP-Server",
  },
  {
    id: "sentry",
    name: "sentry",
    description: "Issue details, releases, performance data from Sentry.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sentry"],
    envVars: [
      { name: "SENTRY_AUTH_TOKEN", prompt: "Sentry auth token (organization settings → auth tokens)", secret: true },
    ],
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/sentry",
  },
  {
    id: "google-maps",
    name: "google-maps",
    description: "Geocoding, places, directions via Google Maps.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    envVars: [
      { name: "GOOGLE_MAPS_API_KEY", prompt: "Google Maps API key", secret: true },
    ],
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps",
  },
  {
    id: "codex",
    name: "codex",
    description: "OpenAI Codex CLI as an MCP — delegate code tasks to Codex from Hermes.",
    transport: "stdio",
    command: "codex",
    args: ["mcp-server"],
    source: "https://platform.openai.com/docs/guides/agents-sdk",
  },
];

export function presetById(id: string): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}
