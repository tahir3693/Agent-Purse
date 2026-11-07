// Names missing variables only; never renders a value.
export function EnvNotice({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div role="alert" className="notice">
      <p>
        <strong>Configuration needed.</strong> Missing environment variable
        {names.length > 1 ? "s" : ""}: {names.join(", ")}.
      </p>
      <p className="muted">
        Set them in the Vercel project settings, then redeploy.
      </p>
    </div>
  );
}
