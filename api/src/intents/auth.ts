// Bearer agent authentication (spec-08). The API key is never logged or echoed;
// only its sha256 hex digest is used for lookup. Error bodies are constant.

import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { AgentPolicyStore, AgentRecord } from "../db/stores.js";

const BEARER_RE = /^Bearer\s+(\S+)$/i;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Authenticates the caller. On failure it sends the response (401 unknown or
 * missing key, 403 killed agent) and returns null; otherwise returns the agent.
 */
export async function authenticateAgent(
  store: Pick<AgentPolicyStore, "findAgentByKeyHash">,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AgentRecord | null> {
  const header = req.headers.authorization;
  const match = typeof header === "string" ? BEARER_RE.exec(header) : null;
  if (!match?.[1]) {
    await reply.code(401).send({ error: "unauthorized" });
    return null;
  }

  let agent: AgentRecord | null;
  try {
    agent = await store.findAgentByKeyHash(hashApiKey(match[1]));
  } catch {
    await reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  if (!agent) {
    await reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  if (agent.killed) {
    await reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return agent;
}
