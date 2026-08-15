# MoharamBake PWA

Private mobile ordering MVP for Moharam Basha residents.

The app includes a mobile-first menu, cart, saved customer details, tomorrow delivery slots, order confirmation and PWA install support.

### Connect the Google Sheet
Use the Apps Script backend in `google-apps-script/MoharamBakeBackend.gs`. Deploy it as a Web App, copy its `/exec` URL into `app.js` as `API_URL`, and change `DEMO_MODE` to `false`.

### Publish
This repository includes a GitHub Pages workflow. After the files are in the repository, enable GitHub Pages using **GitHub Actions** as the source. The app can then be installed from its URL without an App Store or Google Play listing.
