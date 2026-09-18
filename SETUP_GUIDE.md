# Setup guide

Steps that can't be done from a coding session — Google and Netlify both
require a human clicking through their own web UI (OAuth consent, plan
upgrades). Everything else (code, sheet, script) is already prepared.

## 1. Staging Google Sheet sync (for testing on branch deploys/previews)

A blank staging Sheet has already been created:
https://docs.google.com/spreadsheets/d/1fseJWgK-rwGkRfNeua2PTeF332GOL0zFsI96E_LmREQ/edit

1. Open it → **Extensions → Apps Script**.
2. Delete the default `Code.gs` content, paste in this repo's
   [`apps_script.gs`](./apps_script.gs) instead.
3. Run `setupSheets` once (Apps Script editor toolbar → select the
   function → ▶ Run). First run asks you to authorize — approve it.
   This creates the 4 tabs (Customers, Services, Followups, Churned)
   with the right headers.
4. **Deploy → New deployment → type: Web app** → Execute as **Me**,
   Who has access **Anyone** → Deploy → copy the `/exec` URL.
5. Paste that URL into `SYNC_URL_STAGING` near the top of `index.html`'s
   `<script>` (search for `SYNC_URL_STAGING`), commit, push.

Branch deploys and PR previews will then sync to this staging Sheet —
production keeps syncing to the separate prod Sheet untouched.

Re-deploying after editing `apps_script.gs` needs **Manage deployments →
✏️ Edit → Version: New version**, otherwise it keeps serving old code.

## 2. Connect this repo to Netlify for git-based deploys

Can't be done via API — Netlify's repo linking is an OAuth flow only
available in their dashboard.

1. https://app.netlify.com/projects/ccl-crm → **Site settings → Build &
   deploy → Continuous deployment → Link repository**.
2. Pick this GitHub repo, branch `main` as the production branch,
   publish directory `.` (already set in `netlify.toml`), no build
   command.
3. Done — from then on `main` auto-deploys to production and every
   other branch/PR gets its own preview URL (see README → Deploy flow).

## 3. (Optional, costs money) Password-protect preview deploys

Netlify's Visitor Access / password protection needs a **Pro plan**
(the team is currently on Free — attempted via API, got HTTP 422).
Upgrade at https://app.netlify.com/teams/spyzealer/billing, then it's a
one-click toggle in Site settings → Visitor access.

This only closes the preview-deploy exposure — production itself still
ships real customer data baked into `index.html` regardless (see
README → Known limitation). Worth fixing that properly before this.
