import { defaultDeps } from "../../../../lib/deps";
import { handleProxy } from "../../../../lib/handlers/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return handleProxy(req, path ?? [], defaultDeps);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
