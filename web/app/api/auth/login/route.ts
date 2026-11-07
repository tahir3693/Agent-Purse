import { defaultDeps } from "../../../../lib/deps";
import { handleLogin } from "../../../../lib/handlers/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request): Promise<Response> {
  return handleLogin(req, defaultDeps);
}
