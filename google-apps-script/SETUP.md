# MoharamBake → Google Sheets setup

Spreadsheet ID:
`1y3FMn3N_sq8GqSjlSpyobkoIdAWINkPyAYPTMYVkpjg`

## 1. Open Apps Script
Open the Google Sheet → Extensions → Apps Script.

Delete the existing script and paste `MoharamBakeBackend.gs`.

## 2. Run setupSheets()
Select `setupSheets` from the function dropdown and click Run.
Approve the Google authorization.

This creates:
- Products
- Orders
- OrderItems
- Customers

It also adds sample products if Products is empty.

## 3. Deploy as Web App
Deploy → New deployment → Web app.

Use:
- Execute as: Me
- Who has access: Anyone

Copy the Web app URL ending in `/exec`.

## 4. Put the URL in app.js
Replace:

`PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE`

with the `/exec` URL.

`DEMO_MODE` is already set to `false`.

## 5. Deploy the website
Commit the updated files to GitHub. GitHub Pages will deploy them.

## Data flow

Customer
→ MoharamBake PWA
→ Google Apps Script
→ Google Sheet

Orders are written to Orders + OrderItems.
Customer details are stored/updated in Customers.
Products are read from Products.
Opening Active Orders fetches the customer's orders by phone.
Cancellation changes the order Status to Cancelled.
The 10 PM cancellation cutoff is enforced on the server.

IMPORTANT:
The Apps Script Web App URL is intentionally not included in the source package. Paste your deployed `/exec` URL into app.js before going live.
