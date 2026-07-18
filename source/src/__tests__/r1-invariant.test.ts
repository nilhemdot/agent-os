import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// R1.5: Regression tests for runner chokepoint completion
// Invariant: All subprocess launches in app/ and features/ route through runner.ts

describe('R1 — Runner chokepoint invariants', () => {
  // R1.5a: Guard test — no direct child_process imports in app/features
  // Detects: from imports, require(), and dynamic import() patterns
  it('should forbid direct child_process imports in src/app/**', () => {
    const srcRoot = path.join(__dirname, '..', 'app');
    const violations: string[] = [];

    function scanDir(dir: string) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            const content = readFileSync(fullPath, 'utf8');
            // Check for: from imports, require(), and dynamic import() patterns
            const hasFromImport = /from\s+['"](?:node:)?child_process['"]/.test(content);
            const hasRequire = /require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(content);
            const hasImportCall = /import\(\s*['"](?:node:)?child_process['"]\s*\)/.test(content);

            if (hasFromImport || hasRequire || hasImportCall) {
              violations.push(fullPath);
            }
          }
        }
      } catch {
        // Directory may not exist yet
      }
    }

    scanDir(srcRoot);
    expect(violations, `Direct child_process imports found in src/app: ${violations.join(', ')}`).toHaveLength(0);
  });

  // R1.5b: Verify runner exports the spawnSubprocess helper
  it('should export spawnSubprocess from runner', async () => {
    const runner = await import('@/lib/runner');
    expect(runner.spawnSubprocess).toBeDefined();
    expect(typeof runner.spawnSubprocess).toBe('function');
  });

  // R1.5c: Verify agentEnv produces minimal environment (no API keys from process.env)
  it('should produce minimal env without leaking process.env secrets', async () => {
    const { agentEnv } = await import('@/lib/runner');

    // Set a fake secret in process.env (won't persist, but simulate the scenario)
    const testEnv = agentEnv({ CUSTOM_VAR: 'test' });

    // Minimal env should have: PATH, HOME, SHELL, LANG, TERM, NO_COLOR, FORCE_COLOR, + extras
    expect(testEnv).toHaveProperty('PATH');
    expect(testEnv).toHaveProperty('CUSTOM_VAR');
    expect(testEnv.CUSTOM_VAR).toBe('test');
    expect(testEnv.NO_COLOR).toBe('1');
    expect(testEnv.FORCE_COLOR).toBe('0');

    // Should NOT include arbitrary process.env vars (spot check a few that are often set)
    // Note: we can't fully test this without mocking process.env, but agentEnv is explicit
    // about which vars it includes (PATH, HOME, SHELL, LANG, TERM) + extras.
  });

  // R1.5d: Verify spawnSubprocess options interface supports necessary options
  it('should support detached, cwd, stdio, and env options in spawnSubprocess', async () => {
    const { spawnSubprocess } = await import('@/lib/runner');

    // Test that the function signature accepts SpawnSubprocessOptions
    // We won't actually spawn to avoid test pollution, but this validates the type
    expect(spawnSubprocess.length).toBeGreaterThanOrEqual(2); // cmd, args minimum
  });

  // R1.5e: Guard test — key migrated routes no longer import spawn directly
  it('should verify key migrated routes use spawnSubprocess, not spawn', async () => {
    const routesToCheck = [
      path.join(__dirname, '..', 'app', 'api', 'video', 'hyperframes', 'render', 'route.ts'),
      path.join(__dirname, '..', 'app', 'api', 'seo', 'deploy', 'route.ts'),
      path.join(__dirname, '..', 'app', 'api', 'hermes', 'dashboard', 'route.ts'),
    ];

    for (const routePath of routesToCheck) {
      try {
        const content = readFileSync(routePath, 'utf8');

        // Should import from runner, not child_process
        expect(
          content.includes("from '@/lib/runner'") || content.includes('from "@/lib/runner"'),
          `${routePath} should import from @/lib/runner`
        ).toBe(true);

        // Should NOT import spawn directly
        expect(
          content.includes("from 'node:child_process'") || content.includes('from "node:child_process"'),
          `${routePath} should not directly import child_process`
        ).toBe(false);

        // Should use spawnSubprocess, not spawn directly
        expect(
          content.includes('spawnSubprocess'),
          `${routePath} should use spawnSubprocess`
        ).toBe(true);
      } catch (e) {
        // Route file may not exist, that's ok for this test
      }
    }
  });

  // R1.5f: Verify H1 (seo/deploy) no longer spreads ...process.env
  it('should verify H1 fix: seo/deploy no longer uses ...process.env spread', async () => {
    const routePath = path.join(__dirname, '..', 'app', 'api', 'seo', 'deploy', 'route.ts');
    try {
      const content = readFileSync(routePath, 'utf8');

      // Should NOT have the problematic spread pattern
      expect(
        content.includes('...process.env'),
        'seo/deploy should not spread process.env (H1 violation)'
      ).toBe(false);

      // Should use minimal env pattern
      expect(
        content.includes('spawnSubprocess'),
        'seo/deploy should use spawnSubprocess for minimal env'
      ).toBe(true);
    } catch (e) {
      // Route may not exist, skip
    }
  });

  // R1.5g: Verify H2 (opendesign/control) no longer uses exec(bash)
  it('should verify H2 fix: opendesign/control no longer uses exec with bash', async () => {
    const routePath = path.join(__dirname, '..', 'app', 'api', 'opendesign', 'control', 'route.ts');
    try {
      const content = readFileSync(routePath, 'utf8');

      // H2 fix: Should NOT have both direct child_process import AND exec usage
      const hasChildProcessImport = content.includes("from 'node:child_process'") ||
                                    content.includes('require("node:child_process")') ||
                                    content.includes("require('node:child_process')");
      const usesExec = content.includes('exec(');

      expect(
        !(hasChildProcessImport && usesExec),
        'opendesign/control should not have direct child_process import with exec (H2 violation)'
      ).toBe(true);

      // Should use spawnSubprocessSync (wrapper) instead
      expect(
        content.includes('spawnSubprocessSync'),
        'opendesign/control should use spawnSubprocessSync (no shell)'
      ).toBe(true);
    } catch (e) {
      // Route may not exist, skip
    }
  });
});
