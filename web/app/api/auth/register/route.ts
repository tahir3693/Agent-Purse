import { defaultDeps } from "../../../../lib/deps";
import { handleRegister } from "../../../../lib/handlers/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request): Promise<Response> {
  return handleRegister(req, defaultDeps);
}
