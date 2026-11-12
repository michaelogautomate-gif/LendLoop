import type { AuthConfig } from "convex/server";

const clerkJwtIssuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!clerkJwtIssuerDomain) {
  console.warn(
    "[LendLoop] CLERK_JWT_ISSUER_DOMAIN is not set. Configure it in Convex environment variables so Clerk JWTs can be verified."
  );
}

export default {
  providers: clerkJwtIssuerDomain
    ? [
        {
          domain: clerkJwtIssuerDomain,
          applicationID: "convex",
        },
      ]
    : [],
} satisfies AuthConfig;

