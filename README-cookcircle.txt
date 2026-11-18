CookCircle local MVP
===================

Files
-----
* cookcircle-landing.html — the full browser page; HTML, CSS and JavaScript are together in this file
* cookcircle-server.js — Node.js server, API, role access and database setup
* cookcircle.sqlite — created automatically on first launch

Start the website
-----------------
Recommended on Windows: from this folder run

    powershell -NoProfile -ExecutionPolicy Bypass -File .\start-cookcircle.ps1

The script creates and stores a Windows-user-protected document key on first
run, then reuses it. Keep the hidden .cookcircle-document-key.dpapi file with
this database and use the same Windows account.

Use Node.js 22.5 or later. Stop the older CookCircle server with Ctrl+C in its
PowerShell window. In PowerShell, set up the server and start it:

    Set-Location 'C:\Users\hb123\Documents\Codex\2026-11-15\0\outputs'
    $env:COOKCIRCLE_ADMIN_EMAIL = 'admin@example.com'
    $env:COOKCIRCLE_ADMIN_PASSWORD = 'choose-a-long-local-password'
    $env:COOKCIRCLE_DOCUMENT_KEY = 'paste-a-private-64-character-hex-key-here'
    node .\cookcircle-server.js

The platform administrator account is only created from those environment
variables; it is not available through public signup. Use the same admin email
and password in the website's Log in form. Keep them private.

The document key must be a private, random 64-character hexadecimal value. You
can generate one locally with:

    node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

Save the generated key securely and set the exact same value in
COOKCIRCLE_DOCUMENT_KEY every time you restart the server. If the key is lost or
changed, stored cook documents and contact details cannot be decrypted. Do not
paste the key into chat or share it with applicants.

After restarting, open http://localhost:3000/api/health. The current server
should include build "sqlite-dynamic-stakeholders-v1" and
`database.connected: true`. If those are missing, an older server process is
still using port 3000 or the server was started from a different folder.

Database persistence
--------------------
CookCircle stores its live application data in `cookcircle.sqlite` beside the
server file. Users and household profiles, cooks and their service areas,
societies and registrations, bookings, payments, notifications, and admin
reviews are read from and written to SQLite by the backend. The website does
not keep this business data only in the browser.

Run the backend from this same `outputs` folder so it uses the same database.
The admin's reversible Remove action marks a cook or society inactive in the
database, preserving history and allowing Restore. The bin permanently deletes
records only when no linked booking or financial history needs them. Stop the
server before making a backup; copy the SQLite database only after shutdown.


Open http://localhost:3000 and sign in again. Sessions from the earlier JSON-only
server are not carried over. Existing customer accounts are imported from
cookcircle-data.json when the SQLite database is first created.

Signup email or mobile verification
-----------------------------------
New customer and cook signups can use either an email address or a mobile
number as the account sign-in identifier. The selected identifier must be
verified with a six-digit code before signup completes. Email accounts log in
with email; mobile accounts log in with the verified number. Cooks must also
provide a contact number for their profile. Codes expire after 10 minutes, can be resent after 60 seconds,
and are limited to five sends per hour per IP and destination. Mobile account
lookup uses a keyed hash derived from the saved CookCircle document key; keep
that key file with the database and do not change it.

Local development works without delivery credentials: the page displays a
"Local test code" so you can exercise the verification flow. This does not send
an email or text. For actual delivery, configure one or both providers before
starting the server:

Email (Resend): set RESEND_API_KEY and COOKCIRCLE_EMAIL_FROM. The sender must
be allowed by your Resend account. See https://resend.com/docs.

SMS (Twilio): set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN, plus either
TWILIO_FROM (your Twilio sender number) or TWILIO_MESSAGING_SERVICE_SID.
Enter mobile numbers with country code, such as +91 98765 43210. Trial Twilio
accounts may require destination numbers to be verified first. See
https://www.twilio.com/docs/messaging/api/message-resource.

Keep provider credentials private and set them only on the server. Set
COOKCIRCLE_VERIFICATION_MODE=production before launch to disable the local
code-display fallback; signup then fails closed if the selected delivery
provider is not configured. Restart the server after changing environment
variables.

Demo sign-ins
-------------
The local server creates these walkthrough accounts automatically when they
are missing:

Customer
  Email:    demo.customer@cookcircle.local
  Password: CookCircleUser!2026

Cook
  Email:    demo.cook@cookcircle.local
  Password: CookCircleCook!2026

The customer account includes one sample dinner booking assigned to the demo
cook. Its check-in code is 246810. This is simulated sample data; no payment
was collected. To disable creation of demo accounts before public deployment,
set COOKCIRCLE_DEMO_ACCOUNTS=off before starting the server.

Available account areas
-----------------------
* Customer / family: household profile, one-off or five-session meal pack,
  booking, simulated payment, cancellations, notifications and support requests.
* Cook: application status, availability, booking acceptance, service status
  workflow, assigned-apartment schedule, editable professional profile and
  encrypted profile photo. Cooks can request cash out for completed services;
  the request is queued for admin review and does not transfer money in demo mode.
* Society administrator: aggregate resident and meal demand statistics, plus
  requests for more cooking capacity. Household booking details stay private.
* Platform administrator: operations metrics, booking assignment and status,
  cook review, service prices, societies, complaints and capacity requests.

Storage and demo behavior
-------------------------
SQLite stores accounts, households, societies, cook profiles and verification
records, encrypted cook documents and contact details, availability, bookings
and their status history, backup assignments, payments, refunds, subscriptions,
the credit ledger, reviews, complaints, notifications, payouts and administrator
activity. Passwords use scrypt hashes; login sessions are stored as token hashes.
The earlier JSON file is imported automatically and kept as a backup.

Sample cooks and demo payments are labelled as such. Demo payment actions do not
charge money. The alphanumeric CAPTCHA is a local development challenge, not
production bot protection. Before public deployment, configure a provider CAPTCHA, HTTPS,
production session controls and backups, a real payment gateway, cook identity
checks, and operational notification delivery.
