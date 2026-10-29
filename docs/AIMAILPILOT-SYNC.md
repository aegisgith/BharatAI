# AImailPilot attendee sync — the BharatAI side

Every attendee who registers here (the list at `/admin#attendees`) is copied into AImailPilot
within 30 minutes, into two contact lists in the **Bharat AI** folder:

| AImailPilot list | Who |
|---|---|
| BharatAI Innovation 2026 — Attendees | conference registrants, plus campus students who said yes to November (`main_event = 1`) |
| BharatAI Innovation 2026 — Campus Panel | campus-panel registrants who have not said yes |

Never copied: anyone who said no to marketing or used the unsubscribe link, broken addresses, test
registrations. If someone opts out **after** being copied, AImailPilot removes them from both lists
on its next run. (No counts here: the repo is on GitHub and the registration count is withheld until
it passes 5,000. The AImailPilot dialog shows the live numbers.)

AImailPilot **pulls**; this app never pushes. The only code involved here is
`GET /api/external/attendees-export` in `src/index.tsx`. Registration, the admin panel and email
sending are not touched.

---

## Deploy it (once)

Step 1 is yours to run: on 29 Oct 2026 the Claude Code auto-mode classifier refused
`wrangler pages secret put` ("Secret-Store Writes"), as it refuses `wrangler pages deploy` and
production D1 writes (handbook §2 rule 6). A `git push` works from a Claude Code shell.

### 1. Set a new secret (required)

On 29 Oct 2026 AImailPilot's first run got `401 unauthorized`, most likely the way it has failed since
May. Two causes, both fixed that day (secret set, export pushed in `95db7af`):

- **The host.** AImailPilot's default endpoint is `https://networking.bharataiinnovation.com/...`,
  which now answers `301` to `https://bharataiinnovation.com/...`. A fetch that follows a redirect to
  another host drops the `Authorization` header (tested with Node 20), so this endpoint saw no
  secret at all and would have refused even the right one. Step 4 points AImailPilot at the real
  host.
- **The secret.** Cloudflare never shows a secret's value again, so nobody could say whether
  AImailPilot's copy matched. A fresh one was set and goes into AImailPilot in step 4.

Set the secret **before** step 2: a Pages secret takes effect on the next deployment, and step 2 is
that deployment.

```bash
# Git Bash (PowerShell adds a line ending when it pipes to a program)
openssl rand -hex 32 | tr -d '\r\n' > ~/attendee-export-secret.txt
npx wrangler pages secret put ATTENDEE_EXPORT_SECRET --project-name=bharatai-networking < ~/attendee-export-secret.txt
```

Feed the value on stdin like this rather than pasting it at the prompt: on 4 Oct 2026 an interactive
paste saved an empty secret that still showed in `wrangler pages secret list`. Don't send the value
by email or chat. The only place it goes besides Cloudflare is the AImailPilot dialog in step 4;
delete the file after that.

### 2. Commit and push the export change

Other sessions share this checkout, so commit **only** these files (handbook §2 rule 5):

```bash
cd C:\Users\Bhupesh\Documents\GitHub\BharatAI-AGBA-APP
git diff --stat -- src/index.tsx      # expect: 1 file, 36 insertions, 3 deletions
git add docs/AIMAILPILOT-SYNC.md
git commit --only -m "feat(export): attendees-export carries opt-out + main_event; ?mode=state for the AImailPilot sync" -- src/index.tsx docs/AIMAILPILOT-SYNC.md docs/PROJECT-HANDBOOK.md
git push origin main
```

The push is the deploy (Cloudflare Pages, usually 1–5 minutes).

### 3. Check it is live

```bash
npx wrangler pages deployment list --project-name=bharatai-networking    # newest row = your commit
```

PowerShell, with the secret in place of `<SECRET>`:

```powershell
(curl.exe -s -H "Authorization: Bearer <SECRET>" "https://bharataiinnovation.com/api/external/attendees-export?event_id=1&mode=state").Substring(0, 40)
```

Expect `{"mode":"state","attendees":[{"id":...`. If you see `{"error":"unauthorized"}`, the secret in
the command doesn't match the one on Cloudflare. If you see a plain `[{...` list, the new deployment
isn't live yet: wait a minute and try again. A `301 Moved Permanently` page means the URL has the
`networking.` host.

### 4. Switch it on in AImailPilot

1. **Point it at the real host.** The dialog has no endpoint field and the default is the
   `networking.` host (see step 1). Signed in to aimailpilot.com as an admin, open the browser
   console (F12 → Console) and run:
   ```js
   await (await fetch('/api/admin/bharatai-sync/config', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'https://bharataiinnovation.com/api/external/attendees-export' }) })).json()
   ```
   Then `await (await fetch('/api/admin/bharatai-sync/status', { credentials: 'include' })).json()`
   should show that `endpoint`. The dialog's Save sends only the on/off switch and the secret, so it
   leaves the endpoint alone. Once AImailPilot's `DEFAULT_ENDPOINT`
   (`server/services/bharatai-attendee-sync.ts`) names the real host, this step is not needed.
2. aimailpilot.com → **Contacts** → **Actions** → **Sync Bharat AI attendees** (admins only).
3. Paste the secret, leave **Sync automatically every 30 minutes** ticked, then click **Save**.
4. Click **Sync now**. The first run copies everyone and takes about a minute. The dialog
   then shows both lists with their counts, and they appear under **Lists → Bharat AI**.

After that it runs on its own. Open the same dialog any time to see the last run, what was skipped
and why, and any error.

---

## If something goes wrong

- **Undo the BharatAI change:** Cloudflare dashboard → Pages → bharatai-networking → Deployments →
  the previous one → *Rollback*, or `git revert <sha>` and push. AImailPilot keeps working against
  the old export: it stops adding campus students and stops the opt-out clean-up, and resumes both
  when the change is back.
- **Stop the sync:** untick *Sync automatically* in the dialog and click Save. Nothing already
  copied is deleted.
- **The dialog says "Opt-out check: would remove N of M members…":** AImailPilot refused to remove
  more than a fifth of a list in one run, which protects against a bad answer from this endpoint.
  Check the endpoint (step 3) before anything else.

---

## Rules for changing `/api/external/attendees-export`

AImailPilot (`server/services/bharatai-attendee-sync.ts` in that repo) depends on these:

- Auth stays `Authorization: Bearer <ATTENDEE_EXPORT_SECRET>`; any other caller gets 401 before D1
  is read.
- **Default call** (`event_id`, `since`, `limit`, optional `include_campus=1`): a bare JSON array of
  rows ordered by `created_at`, carrying `email`, `name`, `created_at`, `registration_source`,
  `main_event` and `opted_out`. Campus rows stay **excluded unless `include_campus=1`**: the
  paid-pass audience depends on that default.
- **`?mode=state`**: `{ "mode": "state", "attendees": [{ id, email, registration_source, main_event, opted_out }] }`
  for **every** attendee of the event. AImailPilot treats this answer as proof the export is the new
  one; without it, AImailPilot never asks for campus rows.
- `opted_out` is `1` for marketing consent = 0 **or** an unsubscribe, `0` for neither, and `NULL`
  when the database cannot tell. Never send `0` for "unknown": AImailPilot reads `0` as "may email".
- Removing a field or renaming one stops the sync from honouring opt-outs. If the shape has to
  change, change the AImailPilot side in the same release.
