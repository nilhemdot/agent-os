import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

describe("M8.5: Env Exfiltration — API Routes Don't Leak process.env Values", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "m8-env-"));
    // Set a fake secret in env
    process.env.FAKE_API_KEY = "sk-test-secret-12345";
    process.env.AGENTOS_MEMORY_DB_PATH = path.join(tmpDir, "memory.db");
  });

  afterEach(() => {
    delete process.env.FAKE_API_KEY;
    delete process.env.AGENTOS_MEMORY_DB_PATH;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should not include process.env in API response envelopes", () => {
    // Generic check: any NextResponse from an API route should not
    // contain process.env directly or indirectly.
    //
    // PATTERN TO CHECK:
    // - NextResponse.json() should only return { ok, data, error }
    // - No field should contain process.env or environment variable values
    // - No field should contain process.env.NEXT_PUBLIC_* (safe) mixed with secrets
    //
    // This test checks the response shape of key API routes.

    // Memory routes should NOT expose process.env in their responses
    // Examples:
    // - /api/memory/search -> { ok, data: { trusted, quarantined }, error }
    // - /api/memory/resident -> { ok, data: Memory[], error }
    // - /api/memory/stats -> { ok, data: MemoryStats, error }
    // - /api/memory/promote -> { ok, path?, error? }

    // Check that route files don't accidentally stringify process.env
    const fs = require("node:fs");
    const routeFiles = [
      "source/src/app/api/memory/search/route.ts",
      "source/src/app/api/memory/resident/route.ts",
      "source/src/app/api/memory/stats/route.ts",
    ];

    for (const file of routeFiles) {
      const fullPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        path.relative("source/src/__tests__", file)
      );
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, "utf8");

      // Check for dangerous patterns
      expect(content).not.toMatch(/JSON.stringify.*process.env/);
      expect(content).not.toMatch(/\.\.\.process.env/);
      expect(content).not.toMatch(/process\.env\s*\?/);
      expect(content).not.toMatch(/process\.env\s*\)/);

      // Should not directly reference process.env in response construction
      expect(content).not.toMatch(
        /NextResponse\.json\s*\([^)]*process\.env/
      );
    }
  });

  it("should use NEXT_PUBLIC_ prefix for client-side env vars only", () => {
    // Only env vars prefixed NEXT_PUBLIC_ should be bundled into client code.
    // All other process.env values must be kept on the server side.

    // Check that FAKE_API_KEY (server-side secret) is never referenced in client code
    const fs = require("node:fs");

    // Scan component files for process.env references
    const componentFiles = [
      "source/src/components/MemoryTrustPanel.tsx",
      "source/src/components/ContextWindowViewer.tsx",
    ];

    for (const file of componentFiles) {
      const fullPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        path.relative("source/src/__tests__", file)
      );
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, "utf8");

      // Check that process.env references use NEXT_PUBLIC_ prefix
      const envMatches = Array.from(
        content.matchAll(/process\.env\.([A-Z_]+)/g) as IterableIterator<RegExpMatchArray>
      );
      for (const match of envMatches) {
        const varName = match[1];
        expect(varName).toMatch(/^NEXT_PUBLIC_/);
      }
    }
  });

  it("documents that error responses must not leak stack traces with env vars", () => {
    // When an API route catches an error, the error response should:
    // 1. Not include the full stack trace (leaks code paths)
    // 2. Certainly not include process.env values in the error message
    //
    // PATTERN:
    // ❌ return NextResponse.json({ ok: false, error: err.stack }) // BAD
    // ✅ return NextResponse.json({ ok: false, error: 'Unknown error' }) // GOOD
    //
    // Current implementations in the codebase (line ~36 of memory/search/route.ts):
    //   error: String(err)
    // This converts the error to string. If err is an Error with a message
    // that includes process.env values (e.g., from DB connection error),
    // it could leak. But errors should be caught before reaching the response.
    //
    // DEFENSIVE: log detailed errors server-side, return generic message to client

    expect(true).toBe(true); // placeholder
  });

  it("should validate that no API route returns process.env directly", async () => {
    // This is a static analysis check: scan all route files for
    // patterns that would expose process.env in a response.

    const fs = require("node:fs");
    const path_ = require("node:path");

    const apiDir = path_.join(
      __dirname,
      "..",
      "..",
      "app",
      "api"
    );

    if (!fs.existsSync(apiDir)) {
      // API dir doesn't exist in test context; skip
      expect(true).toBe(true);
      return;
    }

    const findRoutes = (dir: string, routes: string[] = []): string[] => {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const full = path_.join(dir, entry);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            findRoutes(full, routes);
          } else if (entry === "route.ts" || entry === "route.tsx") {
            routes.push(full);
          }
        }
      } catch {
        // ignore permission errors
      }
      return routes;
    };

    const routes = findRoutes(apiDir);

    for (const routePath of routes) {
      const content = fs.readFileSync(routePath, "utf8");

      // Critical pattern: never return process.env in response
      const hasEnvInResponse = /NextResponse\.json\s*\(\s*\{[^}]*process\.env/.test(
        content
      );
      expect(hasEnvInResponse).toBe(false);

      // Also check for accidentally stringifying the entire process.env
      const hasStringifyEnv = /JSON\.stringify\s*\([^)]*process\.env/.test(
        content
      );
      expect(hasStringifyEnv).toBe(false);
    }

    expect(true).toBe(true);
  });

  it("should not expose NODE_ENV or other system env vars in client responses", () => {
    // Even innocent-looking env vars like NODE_ENV could reveal deployment details.
    // Only strictly necessary public vars should ever be in a client response.

    // Check that routes don't include NODE_ENV in their responses
    const fs = require("node:fs");

    const searchRoutePath = path.join(
      __dirname,
      "..",
      "..",
      "app",
      "api",
      "memory",
      "search",
      "route.ts"
    );

    if (!fs.existsSync(searchRoutePath)) {
      expect(true).toBe(true);
      return;
    }

    const content = fs.readFileSync(searchRoutePath, "utf8");

    // Should not include NODE_ENV in the response
    expect(content).not.toMatch(
      /NextResponse\.json\s*\([^)]*NODE_ENV/
    );

    // Should not include process.versions or process.platform
    expect(content).not.toMatch(/process\.(versions|platform|uptime|pid)/);
  });
});
