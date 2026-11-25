# website

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Google Analytics and cookie consent

Analytics is optional and off by default. To enable it, set
`NEXT_PUBLIC_GTM_ID` to a dedicated Alvyn web container ID (`GTM-…`):

- **GitHub Pages:** Add an Actions **repository variable** named
  `NEXT_PUBLIC_GTM_ID` under **Settings → Secrets and variables → Actions →
  Variables**, then run the **Docs** workflow. The site is a static export, so
  changing the variable requires a new build/deploy. The ID is public.
- **Local testing:** Copy `.env.example` to `.env.local` in this directory and
  enter a test container ID. Do not use Fanloot’s or the production container.
- Missing or invalid ID: no banner and no Google tags. Cookie Settings remain
  accessible from the homepage footer, docs sidebar and `/privacy`.

### Configure the GTM container and GA4

1. Add **one Google tag** for the Alvyn GA4 measurement ID (`G-…`) to the
   container. Use the standard **Page View / All Pages** trigger (`gtm.js`).
   Leave automatic first pageviews enabled (`send_page_view` at its default);
   do not add a second GA snippet, a History trigger or a separate pageview tag.
2. Turn off **Enhanced Measurement** in the GA4 web stream. The site sends a
   pageview on later client-side navigation; enabling history-based measurement
   as well can double-count visits. GA4 can still send its own events such as
   `session_start` and `user_engagement`.
3. Keep the container analytics-only. No ads, Google Signals, user-provided data,
   User-ID, URL passthrough or unrelated tags. The site owns consent (Basic Consent
   Mode v2): it queues all four signals as denied, then grants only
   `analytics_storage` before loading GTM. Do not override consent or the
   site's page parameters in the container.
4. Preview the container and verify in Tag Assistant, GA4 DebugView and the
   browser network log. Check there are no GTM/GA requests before opt-in, on
   rejection or in a new `/privacy` document; check one pageview after opt-in
   and one per new docs route (including back/forward). Pageview commands use
   known page titles and origin + path, with no query string, hash or supplied
   referrer. Verify actual requests, including automatic GA4 events, not just
   the data layer. Publish the verified container before enabling it in production.

Both choices are saved in `localStorage["alvyn.cookie-consent"]` and are valid
for up to 180 days. Revocation clears reachable standard GA cookies and reloads
any active tracking document. No visits before consent are backfilled.

Before production activation, review the cookie/privacy notice at
`src/app/(home)/privacy/page.tsx` against the actual deployment, published tags,
retention, transfers and applicable disclosure requirements. Increment
`CONSENT_VERSION` in `src/lib/cookie-consent.ts` when the disclosed purposes or
providers materially change to require a fresh choice.

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

### Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different options like frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
