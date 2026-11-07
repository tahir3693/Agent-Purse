import { defaultDeps } from "../../../lib/deps";
import { handleHealth } from "../../../lib/handlers/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Render free instances can take close to a minute to wake up.
export const maxDuration = 60;

export function GET(req: Request): Promise<Response> {
  return handleHealth(req, defaultDeps);
}
