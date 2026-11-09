"use client";

import dynamic from "next/dynamic";
import { getPublicEnv } from "../../lib/publicEnv";
import { EnvNotice } from "../EnvNotice";
import { PageHeader } from "../ui/PageHeader";
import { Skeleton } from "../ui/Skeleton";

// AG Studio needs the DOM: never render it on the server.
const StudioDashboard = dynamic(() => import("../studio/StudioDashboard"), {
  ssr: false,
  loading: () => (
    <div className="studio-frame" role="status">
      <span className="sr-only">Loading AG Studio</span>
      <Skeleton width="100%" height="100%" />
    </div>
  ),
});

export function StudioView() {
  const licenseKey = getPublicEnv().agGridLicenseKey;
  return (
    <div className="stack">
      <PageHeader
        title="Studio"
        description="Build your own view of your agents' spending. The assistant is read-only: it can explain decisions and summarise data, but it cannot approve, deny or change anything. Payments are Braintree sandbox transactions (a PayPal service)."
      />
      {licenseKey ? (
        <StudioDashboard licenseKey={licenseKey} />
      ) : (
        <EnvNotice names={["NEXT_PUBLIC_AG_GRID_LICENSE_KEY"]} />
      )}
    </div>
  );
}
