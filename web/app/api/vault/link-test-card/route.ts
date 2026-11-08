import { defaultDeps } from "../../../../lib/deps";
import { handleLinkTestCard } from "../../../../lib/handlers/linkTestCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request): Promise<Response> {
  return handleLinkTestCard(req, defaultDeps);
}
