# CookCircle — Codex handoff

This guide gives another Codex account the project context needed to continue working on CookCircle. Share this file together with access to the GitHub repository. It contains no passwords, database URLs, OAuth values, or encryption keys.

## Project and repository

- **Project:** CookCircle, a community-based home cooking service.
- **GitHub repository:** [hb008658-tech/CookCircle](https://github.com/hb008658-tech/CookCircle)
- **Primary branch:** `main`
- **Hosted site:** `https://cookcircle.onrender.com`
- **Hosting:** Render serves the Node.js app and web page. Supabase Postgres stores hosted application data.
- **Deployment flow:** a push to `main` triggers Render auto-deploy. The owner manages GitHub/Render access and secrets.

## Start by checking the current work

Before editing, open the repository and inspect its current branch, recent commits, and working tree. The owner may have new edits that are not in this handoff. Preserve unrelated changes and do not reset, force-push, or roll back commits unless the owner specifically asks.

Work in the repository itself. Make focused changes, keep existing behavior, and explain what changed and what needs to be committed/pushed. Do not commit or push unless the owner asks.

## Main files

- `cookcircle-landing.html` — complete front end: landing page, household/cook/admin/society-admin screens, dialogs, styles, and browser-side JavaScript. It is a large single HTML file with several inline scripts and style blocks. Search for the relevant page, ID, event handler, and CSS before editing.
- `cookcircle-server.js` — Node.js HTTP server, API routes, authentication/roles, authorization, validation, email delivery, encryption, and local SQLite setup.
- `cookcircle-postgres-schema.sql`, `cookcircle-postgres-*.js`, and `cookcircle-postgres-ssl.js` — hosted PostgreSQL compatibility/schema and support code. Preserve compatibility with both hosted Postgres and local SQLite paths.
- `cookcircle.sqlite*` — local application data. Never overwrite or commit these files.
- `HOSTING-RENDER.md` — existing Render and Supabase operating guide.
- `README-cookcircle.txt` — local development, account roles, and data notes.
- `package.json` — start command is `npm start`; Node version requirement is `>=22.5.0 <27.0.0`.

## Application shape

The front end talks to the same-origin `/api` backend. User sign-in tokens are stored in per-tab `sessionStorage`, allowing different roles in separate tabs. The server enforces account roles; never rely on hiding a button or section as an authorization check.

The app has these roles:

- **Household/customer:** household profile and registered society; cook availability and booking; simulated payment or meal-pack credits; booking updates and check-in code; cook contact after assignment; notifications and support.
- **Cook:** profile, application/identity review, service societies, availability, a separate **Requests** inbox with accept/decline, schedule, status updates, check-in, and earnings/cash-out history.
- **Platform admin:** operations dashboard, society and cook review, bookings, help requests, complaints, service prices, and operational records.
- **Society admin:** aggregate society-level household and booking information.

Important booking behavior:

- A cook only receives a request for a society that is approved on that cook profile and is active.
- A one-time household booking remains **Requested / Payment due** until the payment step is completed. The app currently simulates payment; it does not charge a real card. Eligible cooks receive offers after payment or when a meal-pack credit is applied.
- The cook sees pending offers in the **Requests** page. Acceptance assigns the booking; decline records the response. If all eligible cooks decline, the household is notified and the booking closes as unavailable.
- A cook's signup selection is not itself final approval. The platform admin must approve the cook and service society.

## Data and secrets — keep private

The hosted database and credentials are configured in Render, not in front-end code. Never request, print, commit, or paste secrets into chat, issue comments, screenshots, or this handoff. This includes:

- `DATABASE_URL`
- `COOKCIRCLE_DOCUMENT_KEY`
- `COOKCIRCLE_PHONE_HASH_KEY`
- Gmail OAuth credentials, refresh tokens, or other delivery-provider credentials
- Admin passwords or user credentials
- `.env`, `.cookcircle-*.dpapi`, `cookcircle.sqlite*`, migration backups, or private key files

For code changes that need secrets, refer to environment-variable *names* only. The owner enters secret values directly in Render. Do not run data migrations, rotate/re-encrypt keys, or alter hosted data unless explicitly asked; those are separate data operations requiring careful backup and coordination.

## Working safely on UI changes

The newest landing-page redesign uses `ccx-*` classes. The existing dashboards and many interactions still use legacy IDs/classes such as `#dashboard`, `#dashboardNav`, `#dashName`, `#customerPortal`, `#rolePortal`, `.nav`, and `#menuLogout`. Keep these compatibility hooks, or update every dependent script and confirm the corresponding API workflow still works. Removing dashboard markup can break sign-in even when the landing page still looks correct.

The household homepage society display is `#householdSocietyHome`. Its value comes from `/api/profile` (`societyName`, `societyCity`), with the loaded society list as a fallback. Keep the profile response and view in sync.

For interactions, trace the entire path: UI event → API request → server route/authorization → database update → refreshed UI. Check both customer and cook sides for booking changes, and check all roles when changing shared navigation, authentication, or common CSS.

## Local checks and update workflow

Use the project's installed Node version. Useful lightweight checks after front-end/backend edits:

```powershell
node --check cookcircle-server.js
git diff --check
```

The HTML contains inline scripts; parse/check them after editing those sections. Do not run tests unless requested by the project owner. Do not run the local server against the owner's real database without checking which database file and credentials it will use.

To publish after the owner reviews the changes:

1. In GitHub Desktop, review the changed files and the diff. Confirm no database, key, password, `.env`, or private config file is included.
2. Use a short commit summary describing the change.
3. Commit to `main` and click **Push origin**.
4. In Render, wait for the deployment to finish and show **Live**. Check `/api/health` and the affected page/flow.

The Codex collaborator should not change Render settings or secrets. A code push is the normal site update path; Render deploys the pushed source while Supabase retains hosted records.

## Communication preference

The owner is learning the hosting workflow and prefers plain-language, step-by-step explanations. For implementation requests, make and review the authorized code changes, then give a simple commit summary and say whether the owner needs to push for Render to update. Do not ask for secrets; never echo them back.
