// POST /api/auth/register (BFF). Creates the owner account only; it never sets
// a session cookie. The UI signs in with /api/auth/login afterwards.
import { envErrorMessage } from "../env";
import {
  fetchWithTimeout,
  isJsonRequest,
  isSameOrigin,
  json,
  type Deps,
} from "../http";

export const REGISTER_MESSAGES = {
  emailTaken: "An account with this email already exists",
  invalid: "Check the highlighted fields",
  rateLimited: "Too many attempts, try again later",
  unavailable: "Registration service unavailable",
};

const FIELD_HINTS: Record<string, string> = {
  email: "Enter a valid email address",
  password: "Use 12 to 256 characters",
};

export async function handleRegister(
  req: Request,
  deps: Deps
): Promise<Response> {
  if (!isSameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  if (!isJsonRequest(req))
    return json({ ok: false, error: "unsupported_media_type" }, 415);
  const env = deps.env();
  if (!env.ok)
    return json(
      { ok: false, error: envErrorMessage(env.missing, env.invalid) },
      500
    );

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(
      {
        ok: false,
        error: REGISTER_MESSAGES.invalid,
        fields: { email: FIELD_HINTS.email },
      },
      400
    );
  }
  const { email, password } = (body ?? {}) as {
    email?: unknown;
    password?: unknown;
  };
  const fields: Record<string, string> = {};
  if (
    typeof email !== "string" ||
    email.trim().length === 0 ||
    email.length > 254
  )
    fields["email"] = FIELD_HINTS.email!;
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    fields["password"] = FIELD_HINTS.password!;
  if (Object.keys(fields).length > 0)
    return json({ ok: false, error: REGISTER_MESSAGES.invalid, fields }, 400);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      deps.fetch,
      `${env.apiBaseUrl}/auth/register`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      },
      deps.timeoutMs
    );
  } catch {
    return json({ ok: false, error: REGISTER_MESSAGES.unavailable }, 502);
  }

  if (res.status === 201) return json({ ok: true }, 201);
  const data = (await res.json().catch(() => ({}))) as {
    error?: unknown;
    fields?: unknown;
  };
  if (res.status === 409)
    return json(
      { ok: false, error: REGISTER_MESSAGES.emailTaken, code: "email_taken" },
      409
    );
  if (res.status === 400) {
    const names = Array.isArray(data.fields)
      ? data.fields.filter((f): f is string => typeof f === "string")
      : [];
    const mapped: Record<string, string> = {};
    for (const n of names) if (FIELD_HINTS[n]) mapped[n] = FIELD_HINTS[n]!;
    return json(
      { ok: false, error: REGISTER_MESSAGES.invalid, fields: mapped },
      400
    );
  }
  if (res.status === 429)
    return json({ ok: false, error: REGISTER_MESSAGES.rateLimited }, 429);
  return json({ ok: false, error: REGISTER_MESSAGES.unavailable }, 502);
}
