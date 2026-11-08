import { defaultDeps } from "../../../lib/deps";
import { handleAssistant } from "../../../lib/handlers/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Render cold start plus up to a few model rounds.
export const maxDuration = 60;

export function POST(req: Request): Promise<Response> {
  return handleAssistant(req, defaultDeps);
}