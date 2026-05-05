# EmailsVia — Sheets add-on

Apps Script project that ships as the EmailsVia Google Workspace Marketplace add-on. The user installs it, opens a Sheet of recipients, pastes their EmailsVia API key once, then clicks "Send mail merge" — the active sheet's rows POST to `/api/v1/campaigns/from-sheet` and a draft campaign appears in the EmailsVia dashboard ready to start.

This folder is the **starter** — when you're ready to publish, move it to its own repo (`emailsvia-sheets-addon/`) and push to Apps Script via [`clasp`](https://github.com/google/clasp).

## Files

| File | Purpose |
|---|---|
| `appsscript.json` | Manifest: scopes, runtime, add-on entry points |
| `Code.gs` | `onHomepage`, `onSelectionChange` — Sheets-side hooks |
| `Cards.gs` | Card UI builders |
| `EmailsVia.gs` | API client (UrlFetchApp wrapper for `/api/v1/...`) |
| `.clasp.json.example` | Copy to `.clasp.json` and fill in the script ID after `clasp create` |

## One-time setup

```bash
npm install -g @google/clasp
clasp login
cd apps-script

# Create a new standalone Apps Script project bound to the manifest in this folder
clasp create --type standalone --title "EmailsVia"

# clasp writes .clasp.json with the new scriptId — copy it to .clasp.json.example
# in this repo so collaborators have a reference.

clasp push
```

Then in the Apps Script editor (`clasp open`):
1. **Project Settings → Show "appsscript.json"**: confirm the manifest matches `appsscript.json` in this folder.
2. **Deploy → Test deployments → Application: Editor add-on, Document: <pick any sheet>**: launches the add-on inside Sheets so you can iterate without publishing.
3. After every code change: `clasp push`, then refresh the Sheet.

## Publishing to the Marketplace

1. Set up an OAuth consent screen under the same Google Cloud project that hosts the EmailsVia OAuth client (`GOOGLE_OAUTH_CLIENT_ID` in the main repo).
2. Add `https://www.googleapis.com/auth/spreadsheets.currentonly` and `https://www.googleapis.com/auth/script.external_request` to the verified scopes list — these get bundled into the same OAuth verification submission as the `gmail.send` / `gmail.readonly` scopes from the main app.
3. **Deploy → New deployment → Editor add-on**, then **Publish → Configure as add-on**.
4. Marketplace assets (collected in this repo's `marketing/` folder when you build them):
   - 1280×800 hero
   - 5 screenshots
   - 2-min demo video (YouTube link)
   - Privacy policy URL: https://emailsvia.com/privacy
   - Terms URL: https://emailsvia.com/terms

## How the add-on talks to EmailsVia

1. User pastes their `eav_live_...` key (from `https://emailsvia.com/app/keys`) into the add-on sidebar.
2. Add-on stores it in `PropertiesService.getUserProperties()` — scoped to the installing user, never leaves their browser via the script's storage.
3. On "Send mail merge", the add-on calls `POST https://emailsvia.com/api/v1/campaigns/from-sheet` with `Authorization: Bearer <key>` and a JSON body:
   ```json
   {
     "name": "Sheet — outreach Q2",
     "subject": "Quick question, {{Name}}",
     "template": "Hi {{Name}},\n...",
     "rows": [
       {"email": "alex@acme.com", "name": "Alex", "company": "Acme", "Role": "Head of RevOps"}
     ]
   }
   ```
4. Server returns `{ campaign_id, recipient_count, duplicates_skipped }`. The add-on opens `https://emailsvia.com/app/campaigns/<campaign_id>` in a new tab so the user lands on the campaign detail with the pre-flight banner ready.

## Why a separate repo eventually

- Marketplace listing requires OAuth verification screenshots tied to the exact `appsscript.json` shipped — easier to manage from a dedicated repo with its own CI.
- Apps Script doesn't support TypeScript natively; keeping `.gs` files away from the Next.js TypeScript codebase prevents IDE confusion.
- Independent release cadence — the web app deploys to Vercel on every commit, the add-on goes through a Marketplace review on every minor change.
