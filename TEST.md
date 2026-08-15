# Quick integration test

After redeploying the Apps Script as a new version, open the Web App URL with:

`?action=products`

It should return JSON.

For the browser JSONP path, use:

`?action=products&callback=testCallback`

A successful response should look like:

`testCallback({"ok":true,"products":[...]});`

If this works, the PWA can read the Products tab without browser CORS blocking.
