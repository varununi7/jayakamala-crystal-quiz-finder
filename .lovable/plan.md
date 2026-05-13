Update the two backend secrets to the new native Google Sheet IDs and redeploy the edge function.

## Steps
1. Update secrets in Lovable Cloud:
   - `GOOGLE_SHEETS_ID` → `1WB8Nnjk-IxHNBASg2SC3AzzZYOJo2D6mhOWq-xnLdWI`
   - `LEADS_SHEET_ID` → `1sc_7uCeDsLUk7Gw9inR8pQAtupU5jyicLlF4QlyPJ-8`
2. Redeploy `crystal-quiz` edge function so it picks up the new IDs and clears the in-memory crystal cache.
3. Smoke test: load the quiz, submit a test lead, confirm the row appears in the new leads sheet and no Sheets API errors in logs.

## Prereqs (user-side, must already be true)
- Both spreadsheets are native Google Sheets (not uploaded `.xlsx`).
- Crystal sheet sharing: "Anyone with the link – Viewer".
- Leads sheet shared with the service account `client_email` as Editor.
- Column structure and tab names match the originals (no code changes needed).