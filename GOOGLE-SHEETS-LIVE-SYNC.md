# CookCircle live Google Sheet

The CookCircle admin page now links to this private Google Sheet:

https://docs.google.com/spreadsheets/d/1RObGhw51s9tLHVMq4Qlvay-8QCGH_FG_8H1t4RoVdzs/edit

It has two tabs: **Cooks** and **Societies**. The backend is prepared to send a fresh snapshot after cook or society signup, profile/review changes, removal, restoration, and permanent deletion. The admin page also has a **Sync now** button.

The sheet intentionally excludes email addresses, phone numbers, home addresses, passwords, identity documents, and payment details. Removed-but-retained records show `Active = No`; a permanently deleted cook or society disappears on the next sync. The sheet remains private to its owner unless you explicitly share it with named admins.

## Finish connecting live sync

The private Sheet and Apps Script project are already created. The script code and its private sync token are saved in Google; the token is also on this computer's clipboard so you can paste it into Render without putting it in chat or GitHub.

1. Open the [CookCircle Live Sheet Sync project](https://script.google.com/home/projects/1yOepDqQKkg1hDBN2K8u_m7U-b9mnxJdwcMFjbHnoeI2I0m99Rh6d3QsV/edit). In its Google authorization window, choose **Advanced → Go to CookCircle Live Sheet Sync (unsafe)** and approve the spreadsheet access. Google shows the unverified-app warning because this private script has not been reviewed by Google; I left that security-warning step for you to approve yourself.
2. In the Apps Script editor, click **Deploy → New deployment**. Choose **Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone** (Render must reach it without a Google sign-in), then click **Deploy**. This publishes an internet-reachable endpoint; it rejects requests without the secret token and only writes to the Cooks and Societies tabs. Keep the Sheet private. Google's [web-app guide](https://developers.google.com/apps-script/guides/web) describes the deployment choices.
3. Copy the Web app URL shown after deployment. In Render, open the **CookCircle** service → **Environment** → **Add Environment Variable** and add:

   | Key | Value |
   | --- | --- |
   | `COOKCIRCLE_SHEETS_SYNC_URL` | The Web app URL from step 2 |
   | `COOKCIRCLE_SHEETS_SYNC_TOKEN` | Paste the private token currently on this computer's clipboard |

   Save the changes. Render will restart/redeploy the service.
4. Wait for the service to finish redeploying.
5. Sign in as admin, open **Cook and society sheet**, and click **Sync now**. The first sync fills both tabs from the hosted database. After that, backend changes keep the tabs current.

If you make a new Apps Script deployment later, update `COOKCIRCLE_SHEETS_SYNC_URL` in Render to the new Web app URL. Do not enable public sharing on the Sheet itself; anyone opening the Sheet link must still be signed into an account you have shared it with.

## Updating the website later

The code changes belong in `cookcircle-server.js`, `cookcircle-landing.html`, and `cookcircle-sheets-sync.gs`. Commit and push those files to the `main` branch in GitHub Desktop; Render will deploy them. The Sheet itself and its ID do not change when the website is updated.
