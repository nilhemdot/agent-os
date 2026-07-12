export interface Usage { inputTokens: number; outputTokens: number; cacheTokens: number; costUsd: number; externalRunId?: string }
const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0 });

function usageFrom(value: unknown): Usage {
  if (!value || typeof value !== "object") return zero();
  const o = value as Record<string, unknown>;
  const u = (o.usage && typeof o.usage === "object" ? o.usage : o) as Record<string, unknown>;
  return {
    inputTokens: Number(u.input_tokens ?? u.inputTokens ?? 0),
    outputTokens: Number(u.output_tokens ?? u.outputTokens ?? 0),
    cacheTokens: Number(u.cache_read_input_tokens ?? u.cached_input_tokens ?? u.cacheTokens ?? 0),
    costUsd: Number(o.total_cost_usd ?? o.cost_usd ?? u.cost_usd ?? 0),
    externalRunId: typeof o.session_id === "string" ? o.session_id : typeof o.id === "string" ? o.id : undefined,
  };
}

export function parseJsonlUsage(text: string): Usage {
  const total = zero();
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const u = usageFrom(JSON.parse(line));
      total.inputTokens += u.inputTokens; total.outputTokens += u.outputTokens;
      total.cacheTokens += u.cacheTokens; total.costUsd += u.costUsd;
      total.externalRunId ||= u.externalRunId;
    } catch { /* non-JSON CLI output */ }
  }
  return total;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// OTLP/JSON mirror of parseClaudeOtelProtobuf: walk resourceMetrics -> scopeMetrics ->
// metrics, keep token.usage/cost.usage, then sum each sum.dataPoint by its `type` attribute.
export function parseClaudeOtelJson(value: unknown): Usage {
  const usage = zero();
  const root = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  for (const rm of asArray(root.resourceMetrics)) {
    for (const sm of asArray((rm as Record<string, unknown>).scopeMetrics)) {
      for (const metric of asArray((sm as Record<string, unknown>).metrics)) {
        const m = metric as Record<string, unknown>;
        const name = typeof m.name === "string" ? m.name : "";
        if (!name.includes("token.usage") && !name.includes("cost.usage")) continue;
        const aggregation = (m.sum ?? m.gauge) as Record<string, unknown> | undefined;
        for (const dp of asArray(aggregation?.dataPoints)) {
          const point = dp as Record<string, unknown>;
          const num = point.asInt !== undefined ? Number(point.asInt)
            : point.asDouble !== undefined ? Number(point.asDouble) : 0;
          let kind = "";
          for (const attr of asArray(point.attributes)) {
            const a = attr as Record<string, unknown>;
            if (a.key === "type" || a.key === "token_type" || a.key === "usage_type") {
              kind = String((a.value as Record<string, unknown> | undefined)?.stringValue ?? "");
            }
          }
          if (name.includes("cost.usage")) usage.costUsd += num;
          else if (/cache/i.test(kind)) usage.cacheTokens += num;
          else if (/output/i.test(kind)) usage.outputTokens += num;
          else usage.inputTokens += num;
        }
      }
    }
  }
  return usage;
}

type ProtoField = { no: number; wire: number; bytes?: Buffer; value?: bigint };
function protoFields(buffer: Buffer): ProtoField[] {
  const out: ProtoField[] = []; let i = 0;
  const varint = () => { let value = BigInt(0), shift = BigInt(0); while (i < buffer.length) { const b = buffer[i++]; value |= BigInt(b & 127) << shift; if (!(b & 128)) break; shift += BigInt(7); } return value; };
  while (i < buffer.length) {
    const tag = varint(), no = Number(tag >> BigInt(3)), wire = Number(tag & BigInt(7));
    if (!no) break;
    if (wire === 0) out.push({ no, wire, value: varint() });
    else if (wire === 1) { out.push({ no, wire, bytes: buffer.subarray(i, i + 8) }); i += 8; }
    else if (wire === 2) { const length = Number(varint()); out.push({ no, wire, bytes: buffer.subarray(i, i + length) }); i += length; }
    else if (wire === 5) { out.push({ no, wire, bytes: buffer.subarray(i, i + 4) }); i += 4; }
    else break;
  }
  return out;
}
const nested = (buffer: Buffer, no: number) => protoFields(buffer).filter((f) => f.no === no && f.bytes).map((f) => f.bytes!);
const textField = (buffer: Buffer, no: number) => protoFields(buffer).find((f) => f.no === no && f.wire === 2)?.bytes?.toString("utf8") || "";

function attributes(dataPoint: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of nested(dataPoint, 7)) {
    const key = textField(kv, 1), any = nested(kv, 2)[0];
    if (key && any) out[key] = textField(any, 1);
  }
  return out;
}

function numberValue(dataPoint: Buffer): number {
  const field = protoFields(dataPoint).find((f) => f.no === 4 || f.no === 6);
  if (!field?.bytes || field.bytes.length !== 8) return 0;
  return field.no === 4 ? field.bytes.readDoubleLE() : Number(field.bytes.readBigInt64LE());
}

export function parseClaudeOtelProtobuf(buffer: Buffer): Usage {
  const usage = zero();
  for (const resourceMetrics of nested(buffer, 1)) for (const scopeMetrics of nested(resourceMetrics, 2)) {
    for (const metric of nested(scopeMetrics, 2)) {
      const name = textField(metric, 1);
      if (!name.includes("token.usage") && !name.includes("cost.usage")) continue;
      const data = nested(metric, 5)[0] || nested(metric, 7)[0];
      if (!data) continue;
      for (const point of nested(data, 1)) {
        const value = numberValue(point), attrs = attributes(point);
        const kind = attrs.type || attrs.token_type || attrs.usage_type || "";
        if (name.includes("cost.usage")) usage.costUsd += value;
        else if (/cache/i.test(kind)) usage.cacheTokens += value;
        else if (/output/i.test(kind)) usage.outputTokens += value;
        else usage.inputTokens += value;
      }
    }
  }
  return usage;
}

export function parseHermesRow(row: Record<string, unknown>): Usage {
  return {
    inputTokens: Number(row.input_tokens || 0), outputTokens: Number(row.output_tokens || 0),
    cacheTokens: Number(row.cache_tokens || 0), costUsd: Number(row.cost_usd || 0),
    externalRunId: row.session_id ? String(row.session_id) : undefined,
  };
}
