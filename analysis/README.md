# CCL CRM — Data Export & Analysis

`build_report.py` pulls live data from the Google Apps Script backend
(the same one the CRM app syncs to — URL embedded in index.html's
`DEFAULT_SYNC_URL`) and builds an Excel analysis workbook.

## Setup
    python3 -m venv .venv
    source .venv/bin/activate
    pip install openpyxl requests

## Run
    python3 analysis/build_report.py

Fetches JSON from the sync endpoint, then writes
`analysis/CCL_CRM_Analysis.xlsx` with sheets:
- **Summary** — KPIs, tier distribution (pie chart), revenue by service type (bar chart), expiring-soon count
- **Customers** — full customer list (245 rows)
- **Services** — full services/subscriptions list (506 rows)
- **Followups** — sales follow-up log
- **Churned** — lost customers, lost revenue, win-back notes
- **Expiring_90d** — services expiring within 90 days, sorted soonest first
