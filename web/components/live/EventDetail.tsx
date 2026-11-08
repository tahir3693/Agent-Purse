"use client";

import { formatMoney } from "../../lib/money";
import type { LiveEvent } from "../../lib/live/connection";
import type { Intent } from "../../lib/types";
import { ShortId } from "../ui/ShortId";
import { AgentRef } from "../views/AgentRef";

/** "$129.00 to keychron.com, agent demo-agent", or the short intent id when the intent is not loaded. */
export function EventDetail({
  event,
  intent,
}: {
  event: LiveEvent;
  intent?: Intent;
}) {
  return (
    <p className="muted event-detail">
      {intent ? (
        <>
          <span className="num">
            {formatMoney({
              amountCents: intent.amountCents,
              currency: intent.currency,
            })}
          </span>{" "}
          to <span className="plain">{intent.payee}</span>
        </>
      ) : (
        <>
          Intent <ShortId id={event.intentId} label="intent id" />
        </>
      )}
      <span aria-hidden="true"> · </span>
      agent <AgentRef id={event.agentId} />
    </p>
  );
}
