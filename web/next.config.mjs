// Next.js config for the AgentPurse web app (Vercel, Root Directory "web").
// The API lives on Render; nothing here builds or bundles it.

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace package compiled by Next, so the web app can import shared schemas.
  transpilePackages: ["@agentpurse/shared"],
};

export default nextConfig;
