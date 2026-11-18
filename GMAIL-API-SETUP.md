# Enable CookCircle verification email on Render Free

For the simpler Google Apps Script method, use
[GOOGLE-APPS-SCRIPT-EMAIL-SETUP.md](GOOGLE-APPS-SCRIPT-EMAIL-SETUP.md). The Gmail
API instructions below are the older alternative and are not needed when the
Apps Script relay is configured.

CookCircle now sends signup codes through the Gmail API over HTTPS. This avoids
Render Free's blocked SMTP ports. The OAuth client secret and refresh token are
private: enter them only in Render's Environment settings and never commit or
share them.

## Create Google OAuth credentials

1. Sign in to [Google Cloud Console](https://console.cloud.google.com/) with the
   Gmail account CookCircle should send from. Create a project, for example
   `CookCircle Email`.
2. In that project, open **APIs & Services → Library**, search for **Gmail API**,
   open it, and click **Enable**.
3. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**).
   Choose **External** for the audience. Enter an app name and your own email as
   the support and developer contact. Add the same Gmail address under **Test
   users** while the app is in Testing.
4. In **Data Access**, add this scope:
   `https://www.googleapis.com/auth/gmail.send`
5. Open **Clients → Create client**. Choose **Web application**. Add this exact
   authorized redirect URI:
   `https://developers.google.com/oauthplayground`
   Create the client and keep its client ID and client secret private.
6. Open [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
   Click the gear icon, enable **Use your own OAuth credentials**, and enter the
   client ID and secret from step 5. Save.
7. In **Step 1**, enter the Gmail send scope from step 4 and click **Authorize
   APIs**. Sign in using the sender Gmail account and approve access.
8. In **Step 2**, click **Exchange authorization code for tokens**. Copy the
   **refresh token**. Do not share it. The access token is temporary; CookCircle
   uses the refresh token to obtain new access tokens when needed.

## Add the values to Render

1. In Render, open the **CookCircle** web service and select **Environment**.
2. Add these four variables. Paste each value directly into Render:

   | Key | Value |
   | --- | --- |
   | `GMAIL_API_SENDER` | The same Gmail address you authorized above |
   | `GMAIL_API_CLIENT_ID` | Google OAuth client ID |
   | `GMAIL_API_CLIENT_SECRET` | Google OAuth client secret |
   | `GMAIL_API_REFRESH_TOKEN` | Google OAuth refresh token |

3. Save changes and wait for Render to restart the service and show **Live**.
4. Try sending a signup verification code. If it fails, open the Render
   service's **Logs** and look for `CookCircle Gmail API`. Do not send the log's
   secrets or tokens to anyone.

## Token lifetime note

Google refresh tokens issued while an External OAuth app is in **Testing**
expire after 7 days for Gmail send access. This is suitable for an initial test,
but you would need to authorize again and replace `GMAIL_API_REFRESH_TOKEN` each
week. Google's production publishing and verification rules may require extra
public app information. See [Google's OAuth token rules](https://developers.google.com/identity/protocols/oauth2#expiration).

The Gmail app password previously used for SMTP is not used by this API setup.
