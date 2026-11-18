# Island Basket

A general-store storefront and admin dashboard for groceries, household goods, electronics, furniture, and more. It uses Node.js and a local SQLite database, so no external database account is needed to try it.

## Run locally

Install Node.js 24 or newer. From this folder in PowerShell:

```powershell
npm install
$env:ADMIN_PASSWORD = "choose-a-long-unique-password"
npm start
```

Open `http://127.0.0.1:3000` for the store and `http://127.0.0.1:3000/admin` for administration. On first startup, `ADMIN_PASSWORD` creates an individual administrator account named `admin`. Sign in with that username and password. If no account exists and `ADMIN_PASSWORD` is not set, sign-in is disabled. The database is created at `data\store.sqlite` and populated with example products on first run. Replace the example products, prices, descriptions, and image URLs before taking real orders.

An administrator must configure **Bank details** before new orders can be placed. These details are public on the checkout page. Customers transfer the displayed subtotal and upload a JPG, PNG, or PDF slip up to 5 MB; staff download the slip and independently check the bank account before marking payment verified. New orders cannot be fulfilled until verified. A rejected slip leaves the order pending and its stock reserved; staff must cancel to release stock, and the customer must place a new order. Pre-existing orders retain their legacy payment status and are not subject to this new verification rule.

Alternatively, set `ADMIN_PASSWORD` in a local `.env` file. This file is ignored by Git; never commit it. An existing environment variable takes precedence over `.env`. This setting is used only when creating the first account: after that, change the password in the dashboard, not in `.env`. Account passwords are stored as salted scrypt hashes. New passwords must contain at least 12 characters.

For development, use `npm run dev` instead of `npm start` to restart the server automatically when server code changes. Both commands build the React/TypeScript inventory workspace before starting. After editing its source while the server is running, run `npm run build` again and refresh the browser.

Optional environment variables: `PORT` (default `3000`), `HOST` (default `127.0.0.1`), `DB_PATH` (database file), `BACKUP_DIR` (backup directory, default `backups` alongside the database), and `COOKIE_SECURE=true` (required when serving over HTTPS). Staff sessions expire after eight hours and are stored as token hashes in the database; changing a password or disabling an account revokes its sessions.

## What works

- Browse, search and sort products; view details; maintain a basket in the browser.
- Add products with any category in the dashboard. Categories automatically appear on the storefront; suggested electronics, furniture, and household categories show “No products yet” until products are added.
- Guest checkout by bank transfer with required slip upload. Orders, slip files, and item prices are stored in SQLite; the server calculates the subtotal, rejects changed prices, and checks and reduces stock atomically.
- Individual admin and staff accounts. Staff can manage orders and products; only admins can manage staff and backups. The initial admin can create staff accounts and reset or disable other accounts.
- Dashboard with order and low-stock counts, delivered-order subtotal (not payment collected), recent orders, searchable/paginated orders and products, order details, status history, and stock filters. Low stock means five or fewer units.
- The overview charts orders placed over the last seven UTC days (including cancellations). Top ordered products are all-time quantities from non-cancelled orders; neither figure represents payments collected.
- Add or edit products and update order statuses. Product edits detect concurrent changes, including stock changes from checkout. Cancelling an order restores its stock; cancelled orders cannot be reopened.
- The React/TypeScript **Variants & stock** workspace adds named options with separate prices and stock at one shared location. The existing product is still sold as the **standard** option, with its own price and stock; set its stock to zero if only named variants should be sold. Customers choose an option before adding it to the basket. Variant names and prices are recorded in orders at checkout. The Products stock filter and overview stock alerts show standard stock only; the variant workspace lists low-stock options separately.
- Record a carrier and tracking number in order details. This is manual reference information, not a carrier integration, automatic tracking, or a delivery-status update.
- Staff can create return requests for delivered orders, approve or reject them, mark accepted goods received (which restocks once), and record manual bank refunds with a transfer reference. Refunds are capped at the returned item value and the remaining paid order value. Refund transfer execution still happens outside the app; the store must set its own return policy.
- Staff can make audited standard or variant stock adjustments. The workspace provides guest-customer order summaries and computed sales, order, product, inventory, customer, return, and payment reports.
- Admins can create and manage active coupon records in Store content. Coupon details use JSON fields `code`, `discount_type` (`percentage` or `fixed`), `value` (whole percent or MVR cents), optional `min_subtotal` (MVR cents), `max_redemptions`, and ISO `expires_at`. Coupons are checked again during atomic checkout, the discount is saved on the order, limits are enforced, and cancellation releases a redemption.
- Admins can maintain CMS and workspace records in Store content. Published `pages`, `blog_posts`, and `faqs` with a unique `slug` are available as JSON from `/api/content/{module}/{slug}`. Other listed records (promotions, gift cards, campaigns, navigation, reviews, communications, media, teams, roles, permissions, integrations, webhooks, and settings) are persisted administrative records; they do not automatically send communications, alter access control, upload media, or integrate with other systems.
- Customers can submit messages through the storefront; admins triage them in Contact inbox.
- Versioned database migrations and verified daily local backups while the server is running. The latest seven automatic backups are retained; manually created backups are not automatically deleted.

Delivery charges and arrangements are **not calculated by the app** and must be confirmed with the customer. Stock is reserved only after an order with a slip is successfully placed, not while a customer transfers money. If stock or prices change before submission, the order may fail after payment; customers must contact the store to resolve this manually. The app does not verify bank statements automatically or execute refunds. AI Workspace is intentionally omitted. Multi-vendor marketplace was excluded by product decision. Multiple warehouses, customer accounts, outbound email/SMS delivery, carrier connections, tax calculation, payment gateway integrations and production hosting are not included. Sample product photos are loaded from Unsplash and require an internet connection.

## Before going live

This is a local starter, not a fully hardened production deployment. Arrange HTTPS, protected persistent storage, off-site backups, strong staff passwords, appropriate privacy policies and access controls, and a production security review. The in-memory login rate limiter and single-process SQLite deployment are not suitable for multiple server instances. Confirm payment and delivery requirements before enabling live orders. Never expose the local development server directly to the internet.

## Backup and restore

The server creates a consistent SQLite snapshot on startup if there is no automatic backup for that UTC day, and checks hourly for a new day. Each backup is checked for database integrity before it is saved. Automatic failures are logged and shown to admins on the Backups page. Backups contain customer data, uploaded payment slips, and password hashes: restrict access to the database and backup directory and keep an encrypted off-site copy. Payment slips are untrusted files; download and inspect them cautiously. A local backup alone cannot protect against loss of the computer.

To restore, stop all application processes, preserve the current `data\store.sqlite` and its `-wal` and `-shm` companions, and copy a trusted backup to `data\store.sqlite` with no old `-wal` or `-shm` files left alongside it. Start the server and verify products, orders, and admin access. A restore replaces current data and staff accounts with the state from the backup; test the procedure on a separate copy first.

## Tests

```powershell
npm test
```
