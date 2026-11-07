import { handleLogout } from "../../../../lib/handlers/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Response {
  return handleLogout(req);
}
