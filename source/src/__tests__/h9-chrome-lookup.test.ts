import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { chromeSearchBases } from "@/app/api/loop/run/route";

// H9 (backlog §5): findChrome() searched only the macOS Playwright cache, so
// renderCheck was permanently "unavailable" on Linux/WSL — these guards pin
// the cross-platform search-base contract.

describe("H9: cross-platform Playwright chromium lookup", () => {
  const ORIG = process.env.PLAYWRIGHT_BROWSERS_PATH;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = ORIG;
  });

  it("includes the linux/WSL cache root", () => {
    expect(chromeSearchBases()).toContain(path.join(os.homedir(), ".cache", "ms-playwright"));
  });

  it("includes the macOS cache root", () => {
    expect(chromeSearchBases()).toContain(
      path.join(os.homedir(), "Library", "Caches", "ms-playwright")
    );
  });

  it("searches one ms-playwright root per platform (linux, mac, windows)", () => {
    const roots = chromeSearchBases().filter((b) => b.endsWith("ms-playwright"));
    expect(roots.length).toBeGreaterThanOrEqual(3);
  });

  it("honors PLAYWRIGHT_BROWSERS_PATH override first", () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "/custom/pw-cache";
    expect(chromeSearchBases()[0]).toBe("/custom/pw-cache");
  });

  it("ignores PLAYWRIGHT_BROWSERS_PATH=0 (hermetic install sentinel)", () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
    expect(chromeSearchBases()[0]).not.toBe("0");
  });
});
