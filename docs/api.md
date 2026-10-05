# Luma Studio API

The API documentation lives in `apps/web/src/content/api-docs.md` and is shown in the app at `/docs/api`
(readable without an account). Keys: Settings → Add-ons (needs the API add-on). Implementation: `apps/api/src/auth/api-keys.ts`
(a bearer key signs requests in as its owner on the normal `/api/*` routes; account, billing, admin, key and feedback
endpoints are blocked for keys) and `apps/api/src/render/routes.ts` (render without the agent).
