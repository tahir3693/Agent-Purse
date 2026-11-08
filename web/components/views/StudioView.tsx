"use client";

import dynamic from "next/dynamic";

import { getPublicEnv } from "../../lib/publicEnv";
import { EnvNotice } from "../EnvNotice";

// AG Studio needs the DOM: never render it on the server.
const StudioDashboard = dynamic(() => import("../studio/StudioDashboard"), {
  ssr: false,
  loading: () => <p className="muted">Loading AG Studio</p>,
});

export function StudioView() {
  const licenseKey = getPublicEnv().agGridLicenseKey;
  return (
    <div className="stack">
      <h1>Studio</h1>
      <p className="muted">
        Build your own view of your agents&apos; spending. The assistant is
        read-only: it can explain decisions and summarise data, but it cannot
        approve, deny or change anything. Payments are Braintree sandbox
        transactions (a PayPal service).
      </p>
      {licenseKey ? (
        <StudioDashboard licenseKey={licenseKey} />
      ) : (
        <EnvNotice names={["NEXT_PUBLIC_AG_GRID_LICENSE_KEY"]} />
      )}
    </div>
  );
}
