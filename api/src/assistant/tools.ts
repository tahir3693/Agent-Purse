// The assistant's tools (spec-09b): exactly four, all READ-ONLY, defined and
// executed here on the server. The ownerId always comes from the JWT, never
// from model arguments. Results are wrapped as untrusted data.
import { z } from "zod";

import {
  OwnerServiceError,
  getAgentPolicy,
  getIntent,
  listAgents,
  listIntents,
  stats,
  type OwnerReadDeps,
} from "../owners/service.js";
import type { ToolSpec } from "./model.js";

const STATES = [
  "pending",
  "denied",
  "escalated",
  "authorized",
  "captured",
  "voided",
  "failed",
] as const;
const TEXT_CAP = 200;
const RESULT_CAP = 12_000;
const DECISION_EVENTS = new Set([
  "intent_escalated",
  "intent_denied",
  "risk_approved",
]);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/** Strip control characters and cap; intent text is untrusted. */
export function clean(text: unknown, max = TEXT_CAP): string {
  const s = String(text ?? "")
    .replace(CONTROL_CHARS, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

interface ReadTool {
  spec: ToolSpec;
  args: z.ZodTypeAny;
  label: string;
  run(deps: OwnerReadDeps, ownerId: string, args: never): Promise<unknown>;
}

const noArgs = z.object({}).strict();

const TOOLS: Record<string, ReadTool> = {
  get_stats: {
    label: "spending stats",
    args: noArgs,
    spec: {
      name: "get_stats",
      description:
        "Read today's spend (integer cents per currency) and counts by decision and state for this owner.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    run: (deps, ownerId) => stats(deps, ownerId),
  },
  list_intents: {
    label: "purchase intents",
    args: z
      .object({
        state: z.enum(STATES).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    spec: {
      name: "list_intents",
      description:
        "List this owner's recent purchase intents, newest first. Amounts are integer cents.",
      input_schema: {
        type: "object",
        properties: {
          state: { type: "string", enum: [...STATES] },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
    run: async (deps, ownerId, args: { state?: string; limit?: number }) => {
      const rows = await listIntents(deps, ownerId, {
        ...args,
        limit: args.limit ?? 20,
      });
      return rows.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        amountCents: r.amountCents,
        currency: r.currency,
        payee: clean(r.payee, 100),
        category: clean(r.category, 60),
        state: r.state,
        decision: r.decision,
        riskScore: r.riskScore,
        createdAt: r.createdAt,
        description: clean(r.description),
        justification: clean(r.justification),
      }));
    },
  },
  list_agents: {
    label: "agents and policies",
    args: noArgs,
    spec: {
      name: "list_agents",
      description:
        "List this owner's agents with kill-switch status and spending policy (limits in integer cents).",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    run: async (deps, ownerId) => {
      const agents = (await listAgents(deps, ownerId)).slice(0, 50);
      return Promise.all(
        agents.map(async (a) => ({
          ...a,
          name: clean(a.name, 80),
          policy: (await getAgentPolicy(deps, ownerId, a.id)).policy,
        }))
      );
    },
  },
  explain_decision: {
    label: "a Risk Guard decision",
    args: z.object({ intentId: z.string().min(1).max(128) }).strict(),
    spec: {
      name: "explain_decision",
      description:
        "Explain why one of this owner's intents was approved, escalated or denied, from the Risk Guard decision record.",
      input_schema: {
        type: "object",
        properties: { intentId: { type: "string" } },
        required: ["intentId"],
        additionalProperties: false,
      },
    },
    run: async (deps, ownerId, args: { intentId: string }) => {
      const { intent, events } = await getIntent(deps, ownerId, args.intentId);
      const decision = [...events]
        .reverse()
        .find((e) => DECISION_EVENTS.has(e.event));
      const m = decision?.meta ?? {};
      const pick = (k: string) =>
        typeof m[k] === "string" || typeof m[k] === "number" || m[k] === null
          ? m[k]
          : undefined;
      return {
        intent: {
          id: intent.id,
          state: intent.state,
          decision: intent.decision,
          riskScore: intent.riskScore,
          amountCents: intent.amountCents,
          currency: intent.currency,
          payee: clean(intent.payee, 100),
          category: clean(intent.category, 60),
          justification: clean(intent.justification),
        },
        decisionRecord: decision
          ? {
              event: decision.event,
              reason:
                typeof m["reason"] === "string"
                  ? clean(m["reason"], 280)
                  : null,
              matchedRule: pick("matchedRule") ?? null,
              stageReached: pick("stageReached") ?? null,
              aiOutcome: pick("aiOutcome") ?? null,
              priceStatus: pick("priceStatus") ?? "unknown",
              priceMedianCents: pick("priceMedianCents") ?? null,
            }
          : null,
        auditTrail: events.map((e) => e.event),
      };
    },
  },
};

/** The only tool specs ever sent to the model. */
export const READ_TOOL_SPECS: ToolSpec[] = Object.values(TOOLS).map(
  (t) => t.spec
);
export const READ_TOOL_NAMES = Object.keys(TOOLS);

export interface ToolOutcome {
  content: string;
  isError: boolean;
  label: string;
}

const wrap = (data: unknown): string => {
  const s = JSON.stringify({ untrusted_data: data });
  return s.length > RESULT_CAP
    ? JSON.stringify({ untrusted_data: "result truncated", truncated: true })
    : s;
};

export async function executeReadTool(
  deps: OwnerReadDeps,
  ownerId: string,
  name: string,
  input: unknown
): Promise<ToolOutcome> {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name)
    ? TOOLS[name]
    : undefined;
  if (!tool) {
    return {
      content:
        "Tool not available. This assistant is read-only and cannot approve, deny, create, kill or change anything.",
      isError: true,
      label: "an unavailable tool",
    };
  }
  const parsed = tool.args.safeParse(input ?? {});
  if (!parsed.success)
    return {
      content: "Invalid arguments for this tool.",
      isError: true,
      label: tool.label,
    };
  try {
    const data = await tool.run(deps, ownerId, parsed.data as never);
    return { content: wrap(data), isError: false, label: tool.label };
  } catch (err) {
    if (err instanceof OwnerServiceError && err.status === 404)
      return { content: "Not found.", isError: true, label: tool.label };
    if (err instanceof OwnerServiceError && err.status === 400)
      return {
        content: "Invalid arguments for this tool.",
        isError: true,
        label: tool.label,
      };
    return { content: "The lookup failed.", isError: true, label: tool.label };
  }
}
