# MoharamBake PWA

Mobile-first bakery ordering app for Moharam Basha residents.

## Current MVP features
- Product menu and categories
- Cart
- Customer details saved locally
- Tomorrow delivery slots
- Active Orders icon in the header
- Active order list
- Cancel order before 10 PM
- PWA install support
- Demo mode
- Google Apps Script backend for Products, Orders, OrderItems and Customers
- Server-side 10 PM cancellation check when live

## Demo mode
`app.js` currently has `DEMO_MODE: true`, so orders are stored locally on the device and use demo products.

## Going live with Google Sheets
1. Open the Apps Script file under `google-apps-script/MoharamBakeBackend.gs`.
2. Paste it into the Apps Script project attached to your Google Sheet.
3. Deploy as Web App, Execute as you, access Anyone.
4. Copy the `/exec` URL.
5. Put that URL in `CONFIG.API_URL` in `app.js`.
6. Change `DEMO_MODE` to `false`.
7. Redeploy/update GitHub Pages.

The backend uses spreadsheet ID:
`1y3FMn3N_sq8GqSjlSpyobkoIdAWINkPyAYPTMYVkpjg`

Do not put secrets or access tokens in this frontend repository.


## Google Sheets integration
See `google-apps-script/SETUP.md`. The app is configured for live mode but requires the deployed Apps Script `/exec` URL in `app.js`.


## Connected Google Apps Script
The frontend is configured to use the deployed Apps Script endpoint.

`https://script.google.com/macros/s/AKfycbzYoty72rrL-5K_VoSNH5hRioyae7BjvEq0Wk68DbVZf7llOo7EOHK2R-OfnBOic6Q14g/exec`


## v9 Google Apps Script integration
GET requests for Products and Orders use JSONP to avoid browser CORS issues with Google Apps Script Web Apps. Redeploy the updated Apps Script as a new Web App version, then deploy the PWA.


## Current Apps Script endpoint
`https://script.google.com/macros/s/AKfycbx2Vkfpsnk-wtYUMF9aky7PySvinXXvWcWweRJVhoeFiGWG5thyoVL6H1elqHAnEq3Eww/exec`


## v11 — startup error fix

The previous build attempted to attach a click handler to `#homeLogoBtn`,
but that element was missing from the HTML. The resulting null-reference
exception stopped JavaScript initialization before `loadProducts()` ran,
which is why the menu was blank.

v11 adds the missing clickable logo and makes the navigation bindings defensive.


## Delivery fee — v12

A fixed **5 EGP delivery fee** is now added to every order.

The fee is applied in both places:

- Frontend checkout displays:
  - Subtotal
  - Delivery: 5 EGP
  - Total
- Google Apps Script calculates the 5 EGP fee server-side, so the final amount saved in `Orders.Total` cannot be bypassed by changing the frontend.

`OrderItems` continue to contain only the actual product lines. The 5 EGP delivery fee is an order-level charge and is not added as a fake product.
