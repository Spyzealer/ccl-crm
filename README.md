# CCL CRM

Customer & Service Management — single-page vanilla HTML/CSS/JS app,
currently live at https://ccl-crm.netlify.app (Netlify site id: fc7ac2d9-f90e-4ca6-83f6-0294ec4c605e).

## Origin
Imported directly from the live Netlify deploy (deploy was uploaded via drag-and-drop /
API, not connected to any Git repo). This repo is the new source of truth going forward.

## Stack
- No build step: plain HTML/CSS/JS in `index.html`
- Chart.js via CDN for graphs
- Data persistence: browser `localStorage` only (no backend/database yet)
  - `STORE_KEY` — customers/services data
  - `PREF_KEY` — UI preferences (theme, density, sidebar, accent)

## Known limitation
Data lives only in the browser's localStorage — not shared across devices/users.
A real backend (Netlify Functions, Supabase, etc.) is needed for multi-user use.

**Real customer data is publicly viewable, on every environment.** The full
customer/service/churn dataset (`window.BASE`, 244 customers) is baked
directly into `index.html`, so anyone who opens the site — production or any
branch/preview deploy — can see it all via view-source, no login needed.
Password-protecting preview deploys was attempted and blocked (Netlify Free
plan doesn't support Visitor Access controls; needs Pro). Production itself
is exposed regardless, so preview protection is a minor fix anyway — the
real one is not shipping real customer data in a public static file (e.g.
serve it from an authenticated endpoint instead of embedding it). Deliberately
deferred for now — revisit before this handles anything more sensitive.

## Local development
Just open `index.html` in a browser, or serve it locally:

    python3 -m http.server 8080

## Deploy flow

`main` = production. Every other branch/PR gets its own preview URL, and
previews never touch the real customer data — that's enforced in code
(`DEFAULT_SYNC_URL` in `index.html` picks the sync target by hostname), not
by process discipline.

| Push to...              | Netlify deploys to                              | Google Sheet sync            |
|--------------------------|--------------------------------------------------|-------------------------------|
| `main`                   | https://ccl-crm.netlify.app (production)          | real prod sheet (`SYNC_URL_PROD`) |
| any other branch          | `https://<branch>--ccl-crm.netlify.app`            | none by default — local-only |
| a PR against `main`      | `https://deploy-preview-<PR#>--ccl-crm.netlify.app` | none by default — local-only |

So: branch → push → check it on its own URL → open a PR → review on the
Deploy Preview → merge to `main` → production updates automatically. No
manual drag-and-drop, and no way to accidentally overwrite the 244 real
customer records in the sheet while testing.

### One-time setup
1. Netlify dashboard → this site → **Site settings → Build & deploy →
   Continuous deployment → Link repository** → point it at this GitHub
   repo (`main` as production branch). This is the one step that has to be
   done by hand in Netlify's UI — after that, every push/PR deploys itself.
2. (Optional, do before relying on staging to test *data* changes) Make a
   second Google Sheet + Apps Script deployment for staging, then set
   `SYNC_URL_STAGING` near the top of `index.html`'s `<script>` so branch
   deploys/previews can exercise sync writes without touching prod.
   Until then, non-production environments just run fully local
   (localStorage only) — which is safe, just not sync-testable.

## Deploy (legacy)
Previously deployed by dragging/uploading the build output to Netlify
directly. Once step 1 above is done, don't do this anymore — push to a
branch or `main` instead so the deploy is reproducible from git history.
