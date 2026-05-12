## Goal
Swap the Google account that owns the two spreadsheets the app uses, without touching schema, fields, or code.

## What the app uses today
- **Crystal catalog (read)** — `supabase/functions/crystal-quiz/index.ts` → `fetchCrystals()` reads via the public Sheets API using `GOOGLE_SHEETS_API_KEY` + `GOOGLE_SHEETS_ID`.
- **Leads sheet (write)** — same function → `appendLeadToSheet()` / `updateLeadColumnInSheet()` use a service account (`GOOGLE_SERVICE_ACCOUNT_JSON`) to write to `LEADS_SHEET_ID` / `LEADS_SHEET_TAB`.

Since fields and tab names stay the same, no code changes are required — only secrets.

## Steps

1. **Set up the new Google account**
   - In the new account's Google Cloud project, enable the **Google Sheets API**.
   - Create a **Service Account** and download its JSON key.
   - Create an **API key** (restricted to Google Sheets API) for the public-read crystal sheet.

2. **Recreate / move the two spreadsheets under the new account**
   - The crystal-data spreadsheet — keep the exact same column headers (`name/crystal`, `function*`, `collection*`, `chakra`, `color`, `element`).
   - The leads spreadsheet — keep the same tab name (currently `Leads` unless `LEADS_SHEET_TAB` was overridden) and the same column order: timestamp, name, email, top recommendations, Wants Crystals, Wants Personalised Report.
   - Share the **leads** spreadsheet with the new service account's `client_email` as **Editor**.
   - For the **crystal** spreadsheet, set link sharing to "Anyone with the link – Viewer" (the public API key path requires this).

3. **Update the four backend secrets in Lovable Cloud** with the new values:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — paste the entire new service-account JSON file.
   - `GOOGLE_SHEETS_API_KEY` — new API key from the new Google project.
   - `GOOGLE_SHEETS_ID` — new crystal-catalog spreadsheet ID.
   - `LEADS_SHEET_ID` — new leads spreadsheet ID.
   - `LEADS_SHEET_TAB` — only update if the new leads tab name differs from the current one.

4. **Redeploy + verify**
   - The edge function picks up new secrets on next invocation; trigger a redeploy of `crystal-quiz` to be safe.
   - Smoke test: load the quiz (verifies crystal read), submit a test lead (verifies sheet append), confirm the row lands in the new leads sheet.
   - Check edge function logs for any auth errors.

## Notes
- No database, RLS, or frontend changes are needed.
- The 5-minute crystal cache (`CACHE_MS`) means the old catalog may serve briefly after the swap; a redeploy clears it.
- If you'd rather switch to the OAuth-based Google Sheets connector (so you don't manage a service account), that's a separate, larger change — say the word and I'll plan it.