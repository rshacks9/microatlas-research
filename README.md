# MicroAtlas Research paid storefront

Public static storefront for MicroAtlas Research.

Important: this repository intentionally does not include report PDFs, markdown source files, or paid ZIP bundles. Paid delivery files are stored outside this deploy directory and are delivered by email after checkout.

Checkout links are controlled by `assets/checkout-links.json`. Paste real PayPal Payment Link, Stripe Payment Link, or Gumroad URLs into `checkout_links.csv`, run `scripts/apply_checkout_links.py`, then redeploy.
