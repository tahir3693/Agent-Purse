"use client";

import { useAgentNames } from "../../lib/client/agentNames";
import { ShortId } from "../ui/ShortId";

/** The agent's name when it is already loaded in the client, otherwise its short id. */
export function AgentRef({ id }: { id: string }) {
  const names = useAgentNames();
  const name = names.get(id);
  return name ? (
    <span className="agent-ref" title={id}>
      {name}
    </span>
  ) : (
    <ShortId id={id} label="agent id" />
  );
}
