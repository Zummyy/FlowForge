/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next's dev server blocks dev resources (JS chunks) when the request's
  // Origin hostname isn't in its trusted list. `localhost` is allowed by
  // default, but `127.0.0.1` is not — a page opened via the IP then
  // SSR-renders without ever hydrating (silently unclickable). Trust it so
  // `next dev` + http://127.0.0.1:3000 works out of the box (the E2E suite,
  // scripts/test-vault-ui.mjs, probes both hosts).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
