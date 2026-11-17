# Island Basket

A grocery storefront and admin dashboard, inspired by the shopping flow of AgroMart and built with original branding. It uses Node.js and a local SQLite database, so no external database account is needed to try it.

## Run locally

Install Node.js 24 or newer. From this folder in PowerShell:

```powershell
$env:ADMIN_PASSWORD = "choose-a-long-unique-password"
npm start
```

Open `http://127.0.0.1:3000` for the store and `http://127.0.0.1:3000/admin` for administration. Sign in with the password you set. If `ADMIN_PASSWORD` is not set, admin sign-in is disabled. The database is created at `data\store.sqlite` and populated with example products on first run. Replace the example products, prices, descriptions, and image URLs before taking real orders.

Optional environment variables: `PORT` (default `3000`), `HOST` (default `127.0.0.1`), `DB_PATH` (database file), and `COOKIE_SECURE=true` (required when serving over HTTPS). The admin session is held in server memory and expires after eight hours or a server restart.

## What works

- Browse, search and sort products; view details; maintain a basket in the browser.
- Guest checkout with cash on delivery. Orders and their item prices are stored in SQLite; the server calculates the subtotal, rejects changed prices, and checks and reduces stock atomically.
- Password-protected administration for adding or editing products, viewing orders and updating their statuses. Cancelling an order restores its stock; cancelled orders cannot be reopened.

Delivery charges and arrangements are **not calculated by the app** and must be confirmed with the customer. Online payments, customer accounts, automated notifications, delivery zones, taxes and production hosting are not included. Sample product photos are loaded from Unsplash and require an internet connection.

## Before going live

This is a local starter, not a fully hardened production deployment. Arrange HTTPS, persistent and backed-up database storage, a strong admin password, appropriate privacy policies and access controls, and a production security review. A single-process SQLite deployment and in-memory admin sessions are not suitable for multiple server instances. Confirm payment and delivery requirements before enabling live orders. Never expose the local development server directly to the internet.

## Tests

```powershell
npm test
```
