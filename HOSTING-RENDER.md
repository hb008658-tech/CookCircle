# Host CookCircle on Render with Supabase

This setup keeps CookCircle's website and backend together on Render, while
Supabase stores the live data. The migration tool copies the local SQLite
database into Supabase and re-encrypts saved cook documents and profile photos
with a new private key. It never writes your database password or keys into the
project files.

## Before you start

- Do not publish `.cookcircle-*.dpapi`, `.env`, `cookcircle.sqlite*`, or any
  password/key in a screenshot. The repository's `.gitignore` excludes them.
- Use the Supabase **Session pooler** connection string (the one using the
  pooler host and port 5432), not a Supabase API key or `SUPABASE_URL`.
  Copy the whole URI from **Connect → Session pooler**. Its username should
  start `postgres.` followed by your project reference. Replace only the
  password placeholder with your database password; percent-encode reserved
  symbols if the password contains them.
- Download the project's public database CA certificate in Supabase under
  **Project Settings → Database → SSL Configuration**. Save it in this folder
  as `supabase-ca.crt`. CookCircle uses it to verify Supabase's TLS certificate;
  certificate checks stay on.
- Keep the existing local database and its protected key file until the hosted
  site has been confirmed. The migration creates a separate backup first.
- Keep one Render service instance. This compatibility bridge is for a small
  single-instance MVP; it serializes database calls, so it is not intended for
  high traffic or autoscaling.

## 1. Copy your local records into Supabase

1. Download the CA certificate as described above and save it in the `outputs`
   folder as `supabase-ca.crt`.
2. Close CookCircle by pressing **Ctrl+C** in the PowerShell window running the
   server. Leave the SQLite database and `.cookcircle-document-key.dpapi` file
   in the `outputs` folder.
3. Open File Explorer and go to:
   `C:\Users\hb123\Documents\Codex\2026-11-15\0\outputs`
4. Double-click `migrate-cookcircle-to-supabase.cmd`.
5. When asked, type `MIGRATE` and press Enter.
6. Paste the full Supabase Session Pooler connection string at the hidden
   prompt. It will not appear on screen. Press Enter. Do not paste it into chat
   or save it in a project file.
7. Wait for `CookCircle SQLite → Supabase migration completed.` and the table
   row counts. If the tool reports an error, the SQLite source is unchanged;
   stop and resolve the message before trying again.
8. The tool saves a private local backup under `Documents\CookCircle-Backups`
   and stores the replacement document key in a Windows-protected file. After a
   successful copy, the new document key is placed on the clipboard.

If the command window closed before you could read the result, do not run the
migration again. Double-click `verify-cookcircle-supabase.cmd`, enter the same
connection string at its hidden prompt, and confirm all table totals say
`MATCH`. This check is read-only and does not require either encryption key.

The importer refuses to copy over data if any CookCircle table in Supabase
already contains records. It copies all current CookCircle tables and verifies
the row counts. It re-encrypts existing cook contact details, profile photos,
and identity documents for the new key. Existing phone sign-in hashes are
preserved separately.

## 2. Update your Render service

1. Open the CookCircle service in Render. If you are still on the setup page
   showing **$7/month**, cancel that draft and choose the Free instance before
   creating the service. Supabase is the persistent database, so Render does
   not need a disk.
2. In the service's **Settings**, use:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
3. Open the service's **Environment** tab and add these variables. Click **Add
   Environment Variable** for each row:

   Replace any document key you already entered there with the new key created
   by the migration. The source/local key is not the hosted document key.

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | Full Supabase Session Pooler connection string |
   | `COOKCIRCLE_DOCUMENT_KEY` | The new key currently on your clipboard from the migration |
   | `COOKCIRCLE_PHONE_HASH_KEY` | The old local key, copied by double-clicking `copy-cookcircle-key.cmd` |
   | `COOKCIRCLE_DEMO_ACCOUNTS` | `off` |

   Keep the old key in `COOKCIRCLE_PHONE_HASH_KEY` so existing mobile sign-ins
   continue to match. The migration key is different and goes in
   `COOKCIRCLE_DOCUMENT_KEY` to unlock the re-encrypted documents and photos.
   First paste the clipboard value from the migration into
   `COOKCIRCLE_DOCUMENT_KEY`. Then double-click `copy-cookcircle-key.cmd` and
   paste its clipboard value into `COOKCIRCLE_PHONE_HASH_KEY`. If you need to
   copy the new key again, double-click `copy-cookcircle-hosted-key.cmd`.

4. Do not add the database password or either key to GitHub, a source file, or
   a chat message. Enter them directly into Render's Value fields.
5. Click **Save Changes**. Render restarts/redeploys the service with these
   settings.

If you have not configured the admin credentials for this migrated database,
set `COOKCIRCLE_ADMIN_EMAIL` and `COOKCIRCLE_ADMIN_PASSWORD` to the admin login
you intend to use. Supplying these on startup sets that account as the platform
administrator and resets its password to the supplied value.

## 3. Publish the new backend code

1. Open GitHub Desktop and select the local **CookCircle** repository.
2. The new migration/backend files should appear under **Changes**. Review that
   no `.dpapi`, `.sqlite`, `.env`, or secret file is selected. `supabase-ca.crt`
   is a public certificate and should be included with the project files.
3. Enter a summary such as `Add Supabase Postgres hosting` and click **Commit
   to main**.
4. Click **Push origin**. Render will build and deploy the pushed version.
5. In Render, wait for the deployment to say **Live**. Open the service URL,
   then add `/api/health`. It should report `database.engine` as `PostgreSQL`,
   `database.connected` as `true`, and build `postgres-migration-bridge-v1`.
6. Log in and check a few existing accounts, bookings, societies, cook photos,
   and admin records before inviting anyone. Your browser may require a fresh
   login because the hosted site has a different web address.

## Future website updates

Edit the project files, then use GitHub Desktop to review, commit, and **Push
origin**. Render automatically deploys each pushed change. The data remains in
Supabase and is not replaced by a website code update.

## Important limitations

- The backend supports a small, single Render instance with Supabase Postgres.
  It uses a synchronous compatibility bridge, which serializes requests; plan a
  proper asynchronous database refactor before production/high traffic.
- Render Free instances may sleep when idle. Supabase Free projects may pause
  after a period of inactivity. First visits after sleep/pause can be delayed.
- Email/SMS verification still requires a delivery provider configured in
  Render. The database migration does not send verification messages by itself.
- Payments in this version are simulated, not real card charges.
