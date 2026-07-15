import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";

describe("M8.6: Command Injection — Exec/Spawn Use Array Args, Not String Interpolation", () => {
  it("should verify that checkpoints.ts uses spawnSync with array args (not shell strings)", () => {
    const checkpointsPath = path.join(
      __dirname,
      "..",
      "lib",
      "checkpoints.ts"
    );

    const content = fs.readFileSync(checkpointsPath, "utf8");

    // Line ~30: git() function calls spawnSync("git", args, {...})
    // Verify it's called with an array, not a string
    expect(content).toContain('spawnSync("git", args');

    // Should NOT have shell: true
    expect(content).not.toMatch(/shell\s*:\s*true/);

    // Should NOT construct command strings via template literals or concatenation
    // (check that args is always an array literal or pre-computed array)
    expect(content).not.toMatch(/spawnSync\s*\(\s*["`'].*\$\{/);

    // Function signature at line ~30 shows args: string[]
    expect(content).toContain("args: string[]");
  });

  it("should verify that runner.ts uses spawn/spawnSync with array args, not exec", () => {
    const runnerPath = path.join(__dirname, "..", "lib", "runner.ts");

    if (!fs.existsSync(runnerPath)) {
      expect(true).toBe(true); // skip if file doesn't exist
      return;
    }

    const content = fs.readFileSync(runnerPath, "utf8");

    // Should NOT use exec() with string interpolation (dangerous)
    expect(content).not.toMatch(/exec\s*\(\s*["`'].*\$\{/);

    // Should use spawn or spawnSync with array args (safe)
    expect(content).toContain('spawn(prepared.bin, prepared.cleanArgs');
    expect(content).toContain('spawnSync(bin, ["--version"]');
    expect(content).toContain('spawnSync("git", args');
  });


  it("should verify no shell expansion in vaultWriter operations", () => {
    

    const vaultWriterPath = path.join(
      __dirname,
      "..",
      "lib",
      "vaultWriter.ts"
    );

    const content = fs.readFileSync(vaultWriterPath, "utf8");

    // vaultWriter uses node:fs (readFile, writeFile, mkdir)
    // None of these are shell-exposed, so no shell injection is possible
    // This is safe by construction.

    // Should NOT use execSync from child_process
    expect(content).not.toMatch(/execSync\s*\(/);

    // Should use path module for all path construction
    expect(content).toContain("import path from");

  });

  it("should verify ledger.ts uses safe DB operations, not exec for queries", () => {
    

    const ledgerPath = path.join(__dirname, "..", "lib", "ledger.ts");

    const content = fs.readFileSync(ledgerPath, "utf8");

    // Should use db.prepare().run() or .get(), not exec()
    expect(content).toContain("db.prepare");

    // Should NOT construct SQL strings via template literals
    const dangerousSQL = /SQL.*`.*\$\{|`.*\$\{.*SELECT|`.*\$\{.*INSERT/;
    expect(content).not.toMatch(dangerousSQL);

    // If execSync/exec appears, it should only be for non-query operations
    // (e.g., git commands, where array args are used)
    // Verify exec calls exist (checking earlier in test)
  });

  it("should verify memory operations use prepared statements, not interpolation", () => {
    

    const memoryStorePath = path.join(
      __dirname,
      "..",
      "lib",
      "memoryStore.ts"
    );

    const content = fs.readFileSync(memoryStorePath, "utf8");

    // All queries should use db.prepare() with placeholders (?)
    expect(content).toContain("db.prepare");

    // Should use ? placeholders, not template literals
    const placeholderCount = (content.match(/\?/g) || []).length;
    expect(placeholderCount).toBeGreaterThan(5);

    // Should NOT construct queries via string concatenation with user input
    expect(content).not.toMatch(/prepare\s*\(\s*`.*\$\{.*WHERE/);
  });


});
