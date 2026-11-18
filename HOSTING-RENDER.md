# Host CookCircle and keep updating it

This guide uses GitHub and Render. It gives the existing Node.js + SQLite app a
public `onrender.com` URL, keeps the database on a persistent disk, and deploys
each update pushed to GitHub.

## Before inviting real users

- The hosted database starts empty. The local `cookcircle.sqlite` and Windows
  DPAPI secret files are deliberately excluded from GitHub. Do not upload them
  to the repository. Moving existing accounts/documents needs a separate,
  secure migration; a fresh deployment will need new signups.
- Set `COOKCIRCLE_DEMO_ACCOUNTS=off` and
  `COOKCIRCLE_VERIFICATION_MODE=production` in Render. Configure real email
  delivery before accepting signups; add Twilio settings too if users should
  verify by SMS.
- The current custom CAPTCHA answer is returned by the CAPTCHA API, so it is
  suitable for a prototype but is not a secure public anti-bot check. Replace
  it with server-verified Turnstile or an equivalent provider before collecting
  real identity documents. Payments in this version are simulated; no actual
  card payments are processed.
- This SQLite setup is for one running service instance. Do not scale it to
  multiple instances.

## 1. Publish the code privately to GitHub

1. Install GitHub Desktop and sign in to your GitHub account.
2. In GitHub Desktop, choose **File → Add Local Repository** and select this
   folder: `C:\Users\hb123\Documents\Codex\2026-11-15\0\outputs`.
3. If GitHub Desktop says the folder is not a repository, open PowerShell and
   run:

   ```powershell
   Set-Location 'C:\Users\hb123\Documents\Codex\2026-11-15\0\outputs'
   git init
   ```

   Then return to GitHub Desktop and add the folder again.
4. Click **Publish repository**. Keep **Keep this code private** selected.
5. Confirm the first commit contains the app files and images. It must not
   contain `cookcircle.sqlite`, `cookcircle.sqlite-wal`,
   `cookcircle.sqlite-shm`, `cookcircle-data.json`, `.cookcircle-*.dpapi`, or
   any `.env` file. `.gitignore` excludes these by default.

## 2. Create the hosted service

1. Create a Render account at [render.com](https://render.com/).
2. In the Render dashboard, choose **New → Web Service**, connect GitHub, and
   select the private CookCircle repository.
3. Set the service options:

   - **Runtime:** Node
   - **Branch:** `main`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/api/health`
   - **Instance:** choose a paid plan if keeping SQLite. Render's Free web
     services cannot attach persistent disks.

4. In **Advanced**, add a persistent disk:

   - **Mount path:** `/var/data`
   - **Size:** 1 GB to start

5. Add these environment variables under the service's **Environment** page:

   | Key | Value |
   | --- | --- |
   | `COOKCIRCLE_DB_FILE` | `/var/data/cookcircle.sqlite` |
   | `COOKCIRCLE_DOCUMENT_KEY` | A private 64-character hexadecimal key (generate as described below) |
   | `COOKCIRCLE_ADMIN_EMAIL` | The email address you will use for the admin login |
   | `COOKCIRCLE_ADMIN_PASSWORD` | A new, strong admin password |
   | `COOKCIRCLE_DEMO_ACCOUNTS` | `off` |
   | `COOKCIRCLE_VERIFICATION_MODE` | `production` |

   Generate a new document key locally in PowerShell with:

   ```powershell
   node -p "require('node:crypto').randomBytes(32).toString('hex')"
   ```

   Paste it directly into Render as `COOKCIRCLE_DOCUMENT_KEY`. Save it in a
   password manager. Do not commit it to GitHub. If importing existing
   encrypted cook documents, the hosted service must instead use the original
   document key, not a new one.

6. For email signup verification, add the configured Gmail sender credentials
   as Render environment variables:

   - `GMAIL_SMTP_USER` — your Gmail address
   - `GMAIL_SMTP_APP_PASSWORD` — your Google app password

   Keep these secret. Render Free blocks outbound SMTP ports, so this Gmail
   SMTP setup requires a paid web service. SMS verification also needs the
   relevant Twilio environment variables; without them, mobile verification
   will not send texts.

7. Save the settings and create the web service. Wait for Render's deploy to
   show **Live**.

## 3. Open and verify the site

1. On the Render service page, open its `onrender.com` URL. A custom domain is
   optional.
2. Open `<your-service-url>/api/health`. Confirm it reports:

   - `build: "sqlite-dynamic-stakeholders-v1"`
   - `database.connected: true`
   - `database.file: "cookcircle.sqlite"`

3. Log in with the admin email and password set in Render. Register a test
   society and use test accounts before inviting anyone else.

## 4. Publish future website updates

1. Edit the files in this `outputs` folder. Keep the HTML, server, package
   files, and image assets together in the repository root.
2. Open GitHub Desktop, review the changed files, enter a short summary, and
   click **Commit to main**.
3. Click **Push origin**. Render automatically builds and deploys the new
   commit from `main`.
4. Watch the Render service's **Events/Deploys** page until it shows **Live**,
   then refresh the public URL.

The database lives at `/var/data/cookcircle.sqlite`, outside the replaceable
code files, so code deploys keep the same hosted records. Keep one service
instance and maintain separate database backups.

## Free hosting note

This direct SQLite deployment is not durably free on Render: Free web services
do not support persistent disks, and Render's Free Postgres expires after 30
days. A free persistent-database route would require changing the backend to
use a different managed database. Check [Render pricing](https://render.com/pricing)
before creating paid resources.
