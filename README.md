# MicroAtlas Research paid storefront

Public static storefront for MicroAtlas Research.

Important: this repository intentionally does not include report PDFs, markdown source files, or paid ZIP bundles. Paid delivery files are stored outside this deploy directory and are delivered by email after checkout.

Checkout links are controlled by `assets/checkout-links.json`. Paste real PayPal Payment Link, Stripe Payment Link, or Gumroad URLs into `checkout_links.csv`, run `scripts/apply_checkout_links.py`, then redeploy.

## /tracker/ — Dallas Live Safety Tracker (personal tool, not part of the storefront)

`tracker/index.html` is a standalone, zero-backend dashboard of official City of Dallas public-safety feeds (live DPD active calls, verified DPD incident reports, Dallas Fire-Rescue active incidents). It is `noindex`, is not linked from the storefront, and stores nothing — the browser fetches the city APIs directly. Open the file in a browser or serve it from any static host. The `/dfr-feed` rule in `_redirects` gives it a same-origin proxy for the Fire-Rescue feed on Netlify-compatible hosts.
