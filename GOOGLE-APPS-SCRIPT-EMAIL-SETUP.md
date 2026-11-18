# Simpler Gmail verification setup for CookCircle

This replaces the Gmail OAuth client ID, client secret, and refresh-token flow with a small Google Apps Script that sends only CookCircle verification emails from your Gmail account. The script still needs your approval to send email. Keep its web-app URL and relay token private.

## 1. Create the relay script

1. Sign into the Gmail account you want CookCircle verification messages to come from.
2. Open [script.google.com](https://script.google.com/) and choose **New project**.
3. In the editor, remove the sample code and paste all the contents of `cookcircle-gmail-relay.gs` from this folder.
4. Click **Save** and name the project `CookCircle Gmail Relay`.
5. In the function selector beside **Run**, choose `createCookCircleRelayToken`, then click **Run**.
6. Google will ask you to authorize the script. Review the prompt and allow it to send email from this account.
7. After it finishes, open **Execution log** at the bottom. Copy the long token shown there. Keep it private and do not paste it into this chat. If you need another token later, run `createCookCircleRelayToken` again and update Render with the newly displayed value.

## 2. Deploy it as a web app

1. In the Apps Script editor, click **Deploy** at the top right, then **New deployment**.
2. Click the gear beside **Select type** and choose **Web app**.
3. Set **Execute as** to **Me** (the Gmail account that approved email sending).
4. Set **Who has access** to **Anyone** so Render can call it without a Google sign-in. The secret token protects the sending operation. If Google does not offer public access for your account, this relay cannot be called by Render from that deployment.
5. Click **Deploy** and approve any requested access.
6. Copy the **Web app URL** ending in `/exec`. Do not use the test URL ending in `/dev`.

## 3. Connect it to Render

1. Open the CookCircle service in Render and go to **Environment**.
2. Add these two environment variables:

   | Key | Value |
   | --- | --- |
   | `COOKCIRCLE_GMAIL_RELAY_URL` | The Apps Script web app URL ending in `/exec` |
   | `COOKCIRCLE_GMAIL_RELAY_TOKEN` | The token copied from the Apps Script execution log |

3. Save the changes. Render should redeploy the service. The CookCircle backend will use this relay first when both settings are present. It does not require the `GMAIL_API_CLIENT_ID`, `GMAIL_API_CLIENT_SECRET`, or `GMAIL_API_REFRESH_TOKEN` values.
4. Once this route sends a successful verification email, you may remove the old `GMAIL_API_CLIENT_ID`, `GMAIL_API_CLIENT_SECRET`, and `GMAIL_API_REFRESH_TOKEN` variables from Render. Keep `GMAIL_API_SENDER` only if you plan to return to the old Gmail API method.

## 4. Try a signup email

Open CookCircle, start a signup with an email address you can check, and click **Send code**. If it fails, open the Apps Script project's **Executions** page and Render's service logs. Do not share screenshots that reveal the relay token.

## Free-account limits and safety

Google currently lists a limit of 100 email recipients per day for consumer Gmail accounts using Apps Script; quotas can change. This is suitable for a small demo but not high-volume production. Google also requires the Apps Script owner to authorize mail sending. The web app must be reachable without signing in because Render cannot complete a Google sign-in. The random relay token limits use of that public endpoint; do not place it in website HTML or send it to anyone.
