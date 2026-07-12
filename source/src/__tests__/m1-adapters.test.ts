import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeOtelJson, parseClaudeOtelProtobuf, parseHermesRow, parseJsonlUsage } from "@/lib/runAdapters";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const vi = (n: number) => { const out: number[] = []; do { out.push((n & 127) | (n > 127 ? 128 : 0)); n >>>= 7; } while (n); return Buffer.from(out); };
const msg = (no: number, body: Buffer) => Buffer.concat([vi(no * 8 + 2), vi(body.length), body]);
const str = (no: number, value: string) => msg(no, Buffer.from(value));
const kv = (key: string, value: string) => msg(7, Buffer.concat([str(1, key), msg(2, str(1, value))]));
const point = (kind: string, value: number, double = false) => {
  const number = Buffer.alloc(9); number[0] = (double ? 4 : 6) * 8 + 1;
  if (double) number.writeDoubleLE(value, 1); else number.writeBigInt64LE(BigInt(value), 1);
  return msg(1, Buffer.concat([kv("type", kind), number]));
};
const metric = (name: string, ...points: Buffer[]) => msg(2, Buffer.concat([str(1, name), msg(7, Buffer.concat(points))]));

describe("M1 adapter contracts", () => {
  it("normalizes Claude OTel usage", () => expect(parseClaudeOtelJson(JSON.parse(fixture("claude-2.1.7-otel.json")))).toMatchObject({ inputTokens: 120, outputTokens: 40, cacheTokens: 20, costUsd: 0.012 }));
  it("normalizes Codex JSONL usage", () => expect(parseJsonlUsage(fixture("codex-0.142.5.jsonl"))).toMatchObject({ inputTokens: 100, outputTokens: 25, cacheTokens: 10, externalRunId: "codex_fixture_1" }));
  it("normalizes Hermes SQLite rows", () => expect(parseHermesRow(JSON.parse(fixture("hermes-0.16.0.json")))).toMatchObject({ inputTokens: 80, outputTokens: 20, cacheTokens: 5, costUsd: 0.004, externalRunId: "hermes_fixture_1" }));
  it("decodes Claude OTLP protobuf counters", () => {
    const payload = msg(1, msg(2, Buffer.concat([
      metric("claude_code.token.usage", point("input", 12), point("output", 4), point("cacheRead", 2)),
      metric("claude_code.cost.usage", point("cost", 0.25, true)),
    ])));
    expect(parseClaudeOtelProtobuf(payload)).toEqual({ inputTokens: 12, outputTokens: 4, cacheTokens: 2, costUsd: 0.25 });
  });
});
