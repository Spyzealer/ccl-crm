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

## Local development
Just open `index.html` in a browser, or serve it locally:

    python3 -m http.server 8080

## Deploy
Currently deployed by dragging/uploading the build output to Netlify
(project: ccl-crm). Consider connecting this repo to Netlify for git-based
continuous deployment going forward.
