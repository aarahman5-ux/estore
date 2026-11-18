const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const { migrate, passwordHash } = require('../lib/database');
const { createBackupManager } = require('../lib/backups');

let server;
let base;
let temp;
let cookie;
let product;
let orderId;
let port;
const proof = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0uQAAAAASUVORK5CYII=';

async function call(url, method = 'GET', body, session) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session ? { Cookie: session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
}
async function startServer(bootstrapPassword = 'test-password') {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: path.join(temp, 'test.sqlite'), BACKUP_DIR: path.join(temp, 'backups'), ADMIN_PASSWORD: bootstrapPassword },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stderr.on('data', chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    server.stdout.on('data', chunk => {
      if (chunk.toString().includes('is running')) { clearTimeout(timer); resolve(); }
    });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${output}`)); });
  });
}
before(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'island-basket-test-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  base = `http://127.0.0.1:${port}`;
  await startServer();
});
after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});
test('catalog is populated and administration requires authentication', async () => {
  const stylesheet = await fetch(`${base}/admin.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  const catalog = await call('/api/products');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.data.length > 0);
  product = catalog.data[0];
  assert.equal((await call('/api/admin/orders')).status, 401);
  assert.equal((await call('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
  const login = await call('/api/admin/login', 'POST', { password: 'test-password' });
  assert.equal(login.status, 200);
  cookie = login.cookie.split(';')[0];
  assert.equal((await call('/api/payment-settings')).data, null);
  assert.equal((await call('/api/orders', 'POST', {})).status, 503);
  assert.equal((await call('/api/admin/bank-settings', 'PUT', { bank_name: 'Test Bank', account_name: 'Store', account_number: '123', instructions: '' })).status, 401);
  assert.equal((await call('/api/admin/bank-settings', 'PUT', { bank_name: 'Test Bank', account_name: 'Store', account_number: '123', instructions: '' }, cookie)).status, 200);
});
test('checkout uses server prices, updates stock, and rejects invalid orders', async () => {
  const payload = { name: 'Test customer', phone: '1234567', address: 'Test island', payment_proof: proof, expected_total: product.price * 2, items: [{ product_id: product.id, quantity: 2, price: 1 }] };
  assert.equal((await call('/api/orders', 'POST', { ...payload, payment_proof: '' })).status, 400);
  assert.equal((await call('/api/orders', 'POST', { ...payload, payment_proof: Buffer.from('not a slip').toString('base64') })).status, 400);
  assert.equal((await call('/api/orders', 'POST', { ...payload, expected_total: 1 })).status, 409);
  const order = await call('/api/orders', 'POST', payload);
  assert.equal(order.status, 201);
  assert.equal(order.data.total, product.price * 2);
  orderId = order.data.id;
  assert.equal((await call(`/api/admin/orders/${orderId}`, 'PATCH', { status: 'confirmed' }, cookie)).status, 409);
  assert.equal((await fetch(`${base}/api/admin/orders/${orderId}/payment-proof`)).status, 401);
  const download = await fetch(`${base}/api/admin/orders/${orderId}/payment-proof`, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(proof, 'base64'));
  assert.equal((await call(`/api/admin/orders/${orderId}/payment`, 'PATCH', { status: 'rejected' }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/orders/${orderId}`, 'PATCH', { status: 'confirmed' }, cookie)).status, 409);
  assert.equal((await call(`/api/admin/orders/${orderId}/payment`, 'PATCH', { status: 'verified' }, cookie)).status, 200);
  assert.deepEqual((await call(`/api/admin/orders/${orderId}`, 'GET', undefined, cookie)).data.payment_history.map(item => item.status), ['verified', 'rejected', 'awaiting_verification']);
  const catalog = await call('/api/products');
  assert.equal(catalog.data.find(item => item.id === product.id).stock, product.stock - 2);
  assert.equal((await call('/api/orders', 'POST', { ...payload, items: [{ product_id: product.id, quantity: 100 }] })).status, 409);
  assert.equal((await call('/api/orders', 'POST', { ...payload, items: [null] })).status, 400);
  assert.equal((await call('/api/orders', 'POST', null)).status, 400);
  const orders = await call('/api/admin/orders', 'GET', undefined, cookie);
  assert.equal(orders.data.length, 1);
  assert.equal(orders.data[0].items[0].unit_price, product.price);
});
test('cancellation restores stock once and cannot be reopened', async () => {
  assert.equal((await call(`/api/admin/orders/${orderId}`, 'PATCH', { status: 'cancelled' }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/orders/${orderId}`, 'PATCH', { status: 'cancelled' }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/orders/${orderId}`, 'PATCH', { status: 'confirmed' }, cookie)).status, 409);
  const catalog = await call('/api/products');
  assert.equal(catalog.data.find(item => item.id === product.id).stock, product.stock);
});
test('admin can add and edit products, and invalid prices are rejected', async () => {
  const item = { name: 'Test item', category: 'Test', description: 'Example', unit: '1 piece', price: 1200, original_price: 1500, stock: 3, image: 'https://example.com/image.jpg', featured: true };
  assert.equal((await call('/api/admin/products', 'POST', { ...item, original_price: 100 }, cookie)).status, 400);
  const created = await call('/api/admin/products', 'POST', item, cookie);
  assert.equal(created.status, 201);
  assert.equal((await call(`/api/admin/products/${created.data.id}`, 'PUT', { ...item, stock: 7, version: 0 }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/products/${created.data.id}`, 'PUT', { ...item, stock: 3, version: 0 }, cookie)).status, 409);
  const catalog = await call('/api/products');
  assert.equal(catalog.data.find(product => product.id === created.data.id).stock, 7);
});
test('overview, order history, and paginated filters reflect store activity', async () => {
  const search = await call('/api/admin/order-search?q=Test%20customer&status=cancelled&limit=1&offset=0', 'GET', undefined, cookie);
  assert.equal(search.status, 200);
  assert.equal(search.data.total, 1);
  assert.equal(search.data.items[0].id, orderId);
  assert.equal((await call('/api/admin/order-search?q=%25', 'GET', undefined, cookie)).data.total, 0);
  assert.equal((await call('/api/admin/order-search?limit=999', 'GET', undefined, cookie)).status, 400);
  const detail = await call(`/api/admin/orders/${orderId}`, 'GET', undefined, cookie);
  assert.deepEqual(detail.data.history.map(event => event.status), ['cancelled', 'pending']);
  assert.equal(detail.data.history[0].actor, 'admin');
  const overview = await call('/api/admin/overview', 'GET', undefined, cookie);
  assert.equal(overview.data.pending, 0);
  assert.equal(overview.data.delivered_subtotal, 0);
  const currentProduct = (await call('/api/products')).data.find(item => item.id === product.id);
  const productData = { name: product.name, category: product.category, description: product.description, unit: product.unit, price: product.price, original_price: product.original_price, stock: 5, image: product.image, featured: true, version: currentProduct.version };
  assert.equal((await call(`/api/admin/products/${product.id}`, 'PUT', { ...productData, version: product.version }, cookie)).status, 409);
  assert.equal((await call(`/api/admin/products/${product.id}`, 'PUT', productData, cookie)).status, 200);
  const low = await call('/api/admin/product-search?stock=low&q=banana', 'GET', undefined, cookie);
  assert.equal(low.data.total, 1);
  assert.equal(low.data.items[0].id, product.id);
  assert.ok((await call('/api/admin/overview', 'GET', undefined, cookie)).data.low_stock >= 1);
});
test('staff accounts enforce roles and disabling an account revokes its sessions', async () => {
  const created = await call('/api/admin/staff', 'POST', { username: 'operator', password: 'a-strong-password', role: 'staff' }, cookie);
  assert.equal(created.status, 201);
  assert.equal((await call('/api/admin/staff', 'POST', { username: 'OPERATOR', password: 'a-strong-password', role: 'staff' }, cookie)).status, 409);
  assert.equal((await call('/api/admin/staff', 'POST', { username: 'second', password: 'short', role: 'staff' }, cookie)).status, 400);
  const login = await call('/api/admin/login', 'POST', { username: 'operator', password: 'a-strong-password' });
  assert.equal(login.status, 200);
  const staffCookie = login.cookie.split(';')[0];
  assert.equal((await call('/api/admin/me', 'GET', undefined, staffCookie)).data.role, 'staff');
  assert.equal((await call('/api/admin/order-search', 'GET', undefined, staffCookie)).status, 200);
  assert.equal((await call('/api/admin/staff', 'GET', undefined, staffCookie)).status, 403);
  assert.equal((await call('/api/admin/backups', 'POST', undefined, staffCookie)).status, 403);
  assert.equal((await call('/api/admin/bank-settings', 'GET', undefined, staffCookie)).status, 403);
  assert.equal((await call('/api/admin/password', 'POST', { current_password: 'wrong', new_password: 'another-long-password' }, staffCookie)).status, 400);
  assert.equal((await call('/api/admin/password', 'POST', { current_password: 'a-strong-password', new_password: 'another-long-password' }, staffCookie)).status, 200);
  assert.equal((await call('/api/admin/me', 'GET', undefined, staffCookie)).status, 401);
  const secondLogin = await call('/api/admin/login', 'POST', { username: 'operator', password: 'another-long-password' });
  assert.equal(secondLogin.status, 200);
  const secondCookie = secondLogin.cookie.split(';')[0];
  assert.equal((await call(`/api/admin/staff/${created.data.id}`, 'PATCH', { password: 'reset-long-password' }, cookie)).status, 200);
  assert.equal((await call('/api/admin/me', 'GET', undefined, secondCookie)).status, 401);
  const resetLogin = await call('/api/admin/login', 'POST', { username: 'operator', password: 'reset-long-password' });
  assert.equal(resetLogin.status, 200);
  const resetCookie = resetLogin.cookie.split(';')[0];
  assert.equal((await call(`/api/admin/staff/${created.data.id}`, 'PATCH', { active: false }, cookie)).status, 200);
  assert.equal((await call('/api/admin/me', 'GET', undefined, resetCookie)).status, 401);
  assert.equal((await call('/api/admin/login', 'POST', { username: 'operator', password: 'reset-long-password' })).status, 401);
});
test('manual backups are readable and preserve stored orders', async () => {
  let state;
  for (let attempt = 0; attempt < 50; attempt++) {
    state = await call('/api/admin/backups', 'GET', undefined, cookie);
    if (!state.data.running) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(state.data.running, false);
  const result = await call('/api/admin/backups', 'POST', undefined, cookie);
  assert.equal(result.status, 201);
  const snapshot = new DatabaseSync(path.join(temp, 'backups', result.data.filename), { readOnly: true });
  try {
    assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
  } finally { snapshot.close(); }
});
test('migration preserves legacy orders and bootstraps the admin only once', () => {
  const legacy = new DatabaseSync(':memory:');
  try {
    legacy.exec("PRAGMA foreign_keys=ON; CREATE TABLE products (id INTEGER PRIMARY KEY); INSERT INTO products VALUES (1); CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT); INSERT INTO orders VALUES (12, 'delivered', '2026-01-01 10:00:00'); CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER); INSERT INTO order_items VALUES (1, 12, 1);");
    migrate(legacy, 'legacy-password');
    assert.equal(legacy.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(legacy.prepare('SELECT payment_status FROM orders WHERE id=12').get().payment_status, 'legacy');
    assert.equal(legacy.prepare('SELECT variant_id FROM order_items WHERE id=1').get().variant_id, null);
    assert.equal(legacy.prepare('SELECT version FROM products WHERE id=1').get().version, 0);
    assert.equal(legacy.prepare('SELECT status FROM order_history WHERE order_id=12').get().status, 'delivered');
    const admin = legacy.prepare('SELECT * FROM staff_users').get();
    assert.equal(admin.username, 'admin');
    assert.equal(admin.password_hash, passwordHash('legacy-password', admin.password_salt));
    migrate(legacy, 'different-password');
    assert.equal(legacy.prepare('SELECT password_hash FROM staff_users').get().password_hash, admin.password_hash);
  } finally { legacy.close(); }
});
test('a version 1 database upgrades to version 2 without recreating staff', () => {
  const existing = new DatabaseSync(':memory:');
  try {
    existing.exec("CREATE TABLE products (id INTEGER PRIMARY KEY); INSERT INTO products VALUES (1); CREATE TABLE orders (id INTEGER PRIMARY KEY); CREATE TABLE order_items (id INTEGER PRIMARY KEY); CREATE TABLE staff_users (id INTEGER PRIMARY KEY); INSERT INTO staff_users VALUES (1); PRAGMA user_version = 1;");
    migrate(existing, 'ignored-bootstrap-password');
    assert.equal(existing.prepare('PRAGMA user_version').get().user_version, 7);
    assert.equal(existing.prepare('SELECT version FROM products WHERE id=1').get().version, 0);
    assert.equal(existing.prepare('SELECT COUNT(*) AS count FROM staff_users').get().count, 1);
  } finally { existing.close(); }
});
test('version 2 and 3 databases upgrade without losing products or orders', () => {
  for (const version of [2, 3]) {
    const existing = new DatabaseSync(':memory:');
    try {
      existing.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE products (id INTEGER PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
        INSERT INTO products VALUES (1, 7);
        CREATE TABLE orders (id INTEGER PRIMARY KEY);
        INSERT INTO orders VALUES (12);
        CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER);
        INSERT INTO order_items VALUES (1, 12, 1);
        CREATE TABLE staff_users (id INTEGER PRIMARY KEY);
        INSERT INTO staff_users VALUES (1);`);
      if (version === 3) existing.exec(`
        CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER REFERENCES products(id), name TEXT, price INTEGER, stock INTEGER, version INTEGER);
        INSERT INTO product_variants VALUES (5, 1, 'Blue', 100, 4, 0);
        ALTER TABLE order_items ADD COLUMN variant_id INTEGER REFERENCES product_variants(id);
        UPDATE order_items SET variant_id=5;
        CREATE TABLE order_shipments (order_id INTEGER PRIMARY KEY REFERENCES orders(id));
      `);
      existing.exec(`PRAGMA user_version=${version}`);
      migrate(existing, '');
      assert.equal(existing.prepare('PRAGMA user_version').get().user_version, 7);
      assert.equal(existing.prepare('SELECT version FROM products WHERE id=1').get().version, 7);
      assert.equal(existing.prepare('SELECT payment_status FROM orders WHERE id=12').get().payment_status, 'legacy');
      assert.equal(existing.prepare('SELECT variant_id FROM order_items WHERE id=1').get().variant_id, version === 3 ? 5 : null);
      assert.equal(existing.prepare('SELECT COUNT(*) AS count FROM bank_settings').get().count, 0);
      migrate(existing, '');
    } finally { existing.close(); }
  }
});
test('automatic backup rotation preserves unrelated and manual files', async () => {
  const directory = path.join(temp, 'rotation');
  fs.mkdirSync(directory);
  for (let day = 1; day <= 8; day++) fs.writeFileSync(path.join(directory, `daily-2000-01-${String(day).padStart(2, '0')}.sqlite`), 'old');
  fs.writeFileSync(path.join(directory, 'manual-keep.sqlite'), 'keep');
  const source = new DatabaseSync(':memory:');
  source.exec('CREATE TABLE example (value TEXT); INSERT INTO example VALUES (\'saved\');');
  try {
    const manager = createBackupManager(source, directory);
    const name = await manager.create('daily');
    assert.equal(fs.readdirSync(directory).filter(file => /^daily-/.test(file)).length, 7);
    assert.ok(fs.existsSync(path.join(directory, 'manual-keep.sqlite')));
    const restored = new DatabaseSync(path.join(directory, name), { readOnly: true });
    try { assert.equal(restored.prepare('SELECT value FROM example').get().value, 'saved'); }
    finally { restored.close(); }
  } finally { source.close(); }
});
test('a corrupt existing daily backup is reported instead of marked successful', async () => {
  const directory = path.join(temp, 'corrupt-backup');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, `daily-${new Date().toISOString().slice(0, 10)}.sqlite`), 'not a database');
  const source = new DatabaseSync(':memory:');
  try {
    const manager = createBackupManager(source, directory);
    await assert.rejects(manager.create('daily'));
    assert.ok(manager.status().last_error);
    assert.equal(manager.status().last_success, null);
  } finally { source.close(); }
});
test('overview reports UTC activity and excludes cancelled orders from top products', async () => {
  const before = (await call('/api/admin/overview', 'GET', undefined, cookie)).data;
  assert.equal((await call('/api/admin/overview')).status, 401);
  const payload = { name: 'Report test', phone: '1234567', address: 'Test island', payment_proof: proof, expected_total: product.price, items: [{ product_id: product.id, quantity: 1 }] };
  const delivered = await call('/api/orders', 'POST', payload);
  assert.equal(delivered.status, 201);
  assert.equal((await call(`/api/admin/orders/${delivered.data.id}/payment`, 'PATCH', { status: 'verified' }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/orders/${delivered.data.id}`, 'PATCH', { status: 'confirmed' }, cookie)).status, 200);
  const progress = await call('/api/admin/order-search?status=in_progress', 'GET', undefined, cookie);
  assert.equal(progress.data.total, 1);
  assert.equal(progress.data.items[0].id, delivered.data.id);
  assert.equal((await call(`/api/admin/orders/${delivered.data.id}`, 'PATCH', { status: 'delivered' }, cookie)).status, 200);
  const cancelled = await call('/api/orders', 'POST', { ...payload, expected_total: product.price * 2, items: [{ product_id: product.id, quantity: 2 }] });
  assert.equal(cancelled.status, 201);
  assert.equal((await call(`/api/admin/orders/${cancelled.data.id}`, 'PATCH', { status: 'cancelled' }, cookie)).status, 200);
  const overview = (await call('/api/admin/overview', 'GET', undefined, cookie)).data;
  assert.equal(overview.activity.length, 7);
  assert.equal(overview.activity.at(-1).count, before.activity.at(-1).count + 2);
  assert.equal(overview.today_orders, before.today_orders + 2);
  assert.equal(overview.delivered_subtotal, before.delivered_subtotal + product.price);
  assert.equal(overview.catalog_products, (await call('/api/products')).data.length);
  assert.equal(overview.top_products.find(item => item.id === product.id).quantity, 1);
  assert.equal(overview.low_stock_items.find(item => item.id === product.id).stock, 4);
});
test('sessions survive restart and bootstrap password does not reset existing accounts', async () => {
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await exited;
  await startServer('different-bootstrap-password');
  assert.equal((await call('/api/admin/me', 'GET', undefined, cookie)).status, 200);
  assert.equal((await call('/api/admin/login', 'POST', { username: 'admin', password: 'different-bootstrap-password' })).status, 401);
  assert.equal((await call('/api/admin/login', 'POST', { username: 'admin', password: 'test-password' })).status, 200);
});
test('variant stock, pricing, checkout and cancellation remain independent of standard stock', async () => {
  const created = await call('/api/admin/products', 'POST', { name: 'Variant test', category: 'Test', description: 'Example', unit: 'piece', price: 1000, original_price: null, stock: 4, image: 'https://example.com/image.jpg', featured: false }, cookie);
  const id = created.data.id;
  assert.equal((await call(`/api/admin/products/${id}/variants`, 'GET')).status, 401);
  const variant = await call(`/api/admin/products/${id}/variants`, 'POST', { name: 'Blue / Large', price: 1500, stock: 3 }, cookie);
  assert.equal(variant.status, 201);
  assert.equal((await call(`/api/admin/products/${id}/variants`, 'POST', { name: 'blue / large', price: 1500, stock: 1 }, cookie)).status, 409);
  const vid = variant.data.id;
  assert.equal((await call('/api/admin/low-variants')).status, 401);
  const lowVariants = (await call('/api/admin/low-variants?limit=1', 'GET', undefined, cookie)).data;
  assert.equal(lowVariants.total, 1);
  assert.equal(lowVariants.items[0].id, vid);
  assert.equal(lowVariants.items[0].product_name, 'Variant test');
  const payload = { name: 'Option customer', phone: '123', address: 'Example', payment_proof: proof, expected_total: 4000, items: [{ product_id: id, quantity: 1 }, { product_id: id, variant_id: vid, quantity: 2 }] };
  assert.equal((await call('/api/orders', 'POST', { ...payload, expected_total: 1 })).status, 409);
  assert.equal((await call('/api/orders', 'POST', { ...payload, items: [{ product_id: product.id, variant_id: vid, quantity: 1 }] })).status, 409);
  assert.equal((await call('/api/orders', 'POST', { ...payload, items: [{ product_id: id, variant_id: vid, quantity: 4 }] })).status, 409);
  assert.equal((await call(`/api/admin/products/${id}/variants`, 'GET', undefined, cookie)).data[0].stock, 3);
  const order = await call('/api/orders', 'POST', payload);
  assert.equal(order.status, 201);
  let catalog = (await call('/api/products')).data.find(item => item.id === id);
  assert.equal(catalog.stock, 3);
  assert.equal(catalog.variants[0].stock, 1);
  assert.equal((await call(`/api/admin/products/${id}/variants/${vid}`, 'PUT', { name: 'Blue', price: 1600, stock: 4, version: 0 }, cookie)).status, 409);
  assert.equal((await call(`/api/admin/products/${id}/variants/${vid}`, 'PUT', { name: 'Blue', price: 1600, stock: 4, version: 1 }, cookie)).status, 200);
  const details = await call(`/api/admin/orders/${order.data.id}`, 'GET', undefined, cookie);
  assert.equal(details.data.items[1].name, 'Variant test - Blue / Large');
  assert.equal(details.data.items[1].unit_price, 1500);
  assert.equal((await call(`/api/admin/orders/${order.data.id}`, 'PATCH', { status: 'cancelled' }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/orders/${order.data.id}`, 'PATCH', { status: 'cancelled' }, cookie)).status, 200);
  catalog = (await call('/api/products')).data.find(item => item.id === id);
  assert.equal(catalog.stock, 4);
  assert.equal(catalog.variants[0].stock, 6);
});
test('manual shipment details require authentication and reject stale edits', async () => {
  const path = `/api/admin/orders/${orderId}/shipment`;
  assert.equal((await call(path, 'PUT', { carrier: 'Local', tracking_number: 'ABC', version: null })).status, 401);
  assert.equal((await call(path, 'PUT', { carrier: 'Local', tracking_number: 'ABC', version: null }, cookie)).status, 200);
  assert.equal((await call(path, 'PUT', { carrier: 'Other', tracking_number: '123', version: null }, cookie)).status, 409);
  assert.equal((await call(path, 'PUT', { carrier: 'Other', tracking_number: '123', version: 0 }, cookie)).status, 200);
  assert.equal((await call(path, 'PUT', { carrier: 'Wrong', tracking_number: 'x', version: 0 }, cookie)).status, 409);
  const details = (await call(`/api/admin/orders/${orderId}`, 'GET', undefined, cookie)).data;
  assert.equal(details.shipment.carrier, 'Other');
  assert.equal(details.shipment.tracking_number, '123');
  assert.equal(details.shipment.updated_by, 'admin');
  assert.equal(details.shipment.version, 1);
});
test('payment slip size is enforced without changing stock on rejection', async () => {
  const current = (await call('/api/products')).data.find(item => item.id === product.id);
  const bytes = Buffer.alloc(5 * 1024 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const payload = { name: 'Slip test', phone: '123', address: 'Example', expected_total: current.price, items: [{ product_id: current.id, quantity: 1 }] };
  const oversized = Buffer.concat([bytes, Buffer.from([0])]).toString('base64');
  assert.equal((await call('/api/orders', 'POST', { ...payload, payment_proof: oversized })).status, 400);
  assert.equal((await call('/api/products')).data.find(item => item.id === current.id).stock, current.stock);
  const accepted = await call('/api/orders', 'POST', { ...payload, payment_proof: bytes.toString('base64') });
  assert.equal(accepted.status, 201);
  assert.equal((await call(`/api/admin/orders/${accepted.data.id}`, 'PATCH', { status: 'cancelled' }, cookie)).status, 200);
});
test('manual returns, restocking, partial refunds, and stock audit are transactional', async () => {
  const before = (await call('/api/products')).data.find(item => item.id === product.id).stock;
  const created = await call('/api/orders', 'POST', { name: 'Return customer', phone: '777', address: 'Example', payment_proof: proof, expected_total: product.price * 2, items: [{ product_id: product.id, quantity: 2 }] });
  assert.equal(created.status, 201);
  assert.equal((await call(`/api/admin/orders/${created.data.id}/payment`, 'PATCH', { status: 'verified' }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/orders/${created.data.id}`, 'PATCH', { status: 'delivered' }, cookie)).status, 200);
  const detail = (await call(`/api/admin/orders/${created.data.id}`, 'GET', undefined, cookie)).data;
  const item = detail.items[0];
  const request = await call('/api/admin/returns', 'POST', { order_id: created.data.id, reason: 'One item damaged', items: [{ order_item_id: item.id, quantity: 1 }] }, cookie);
  assert.equal(request.status, 201);
  assert.equal((await call('/api/admin/returns', 'POST', { order_id: created.data.id, reason: 'Too many', items: [{ order_item_id: item.id, quantity: 2 }] }, cookie)).status, 409);
  assert.equal((await call(`/api/admin/returns/${request.data.id}`, 'PATCH', { status: 'received' }, cookie)).status, 409);
  assert.equal((await call(`/api/admin/returns/${request.data.id}/refunds`, 'POST', { amount: product.price, reference: 'X' }, cookie)).status, 409);
  assert.equal((await call(`/api/admin/returns/${request.data.id}`, 'PATCH', { status: 'approved' }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/returns/${request.data.id}`, 'PATCH', { status: 'received' }, cookie)).status, 200);
  assert.equal((await call('/api/products')).data.find(item => item.id === product.id).stock, before - 1);
  assert.equal((await call(`/api/admin/returns/${request.data.id}/refunds`, 'POST', { amount: product.price * 2 + 1, reference: 'X' }, cookie)).status, 400);
  assert.equal((await call(`/api/admin/returns/${request.data.id}/refunds`, 'POST', { amount: product.price, reference: 'BANK-REF-1', note: 'Transferred manually' }, cookie)).status, 201);
  assert.equal((await call(`/api/admin/returns/${request.data.id}/refunds`, 'POST', { amount: 1, reference: 'BANK-REF-2' }, cookie)).status, 400);
  const state = (await call(`/api/admin/returns/${request.data.id}`, 'GET', undefined, cookie)).data;
  assert.equal(state.status, 'received');
  assert.equal(state.items[0].restocked, 1);
  assert.equal(state.refunds.length, 1);
  assert.equal(state.refunds[0].method, 'manual bank transfer');

  assert.equal((await call('/api/admin/stock-adjustments', 'POST', { product_id: product.id, delta: -100000, reason: 'Invalid removal' }, cookie)).status, 409);
  assert.equal((await call('/api/admin/stock-adjustments', 'POST', { product_id: product.id, delta: 2, reason: 'Cycle count correction' }, cookie)).status, 200);
  const audit = await call('/api/admin/stock-adjustments?limit=1', 'GET', undefined, cookie);
  assert.equal(audit.data.items[0].delta, 2);
  assert.equal(audit.data.items[0].actor, 'admin');
});
test('reports, guest customers, content CRUD and contact inbox use stored data', async () => {
  assert.equal((await call('/api/admin/customers')).status, 401);
  assert.equal((await call('/api/admin/reports?type=sales', 'GET', undefined, cookie)).status, 200);
  assert.equal((await call('/api/admin/reports?type=unknown', 'GET', undefined, cookie)).status, 400);
  const customer = await call('/api/admin/customers?q=Test%20customer', 'GET', undefined, cookie);
  assert.equal(customer.status, 200);
  assert.ok(customer.data.total >= 1);
  const record = await call('/api/admin/workspace/pages', 'POST', { title: 'Help page', status: 'published', data: { slug: 'help', body: 'Contact the store.' } }, cookie);
  assert.equal(record.status, 201);
  assert.deepEqual((await call('/api/content/pages/help')).data, { title: 'Help page', slug: 'help', body: 'Contact the store.' });
  const page = await fetch(`${base}/pages/help`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Contact the store\./);
  const unsafe = await call('/api/admin/workspace/pages', 'POST', { title: 'Unsafe', status: 'published', data: { slug: 'safe-escaped', body: '<script>bad()<\\/script>' } }, cookie);
  assert.equal(unsafe.status, 201);
  assert.doesNotMatch(await (await fetch(`${base}/pages/safe-escaped`)).text(), /<script>bad/);
  assert.equal((await call('/api/admin/workspace/pages', 'POST', { title: 'Duplicate slug', status: 'published', data: { slug: 'help' } }, cookie)).status, 409);
  const list = (await call('/api/admin/workspace/pages?limit=10', 'GET', undefined, cookie)).data;
  assert.equal(list.items.length, 2);
  assert.equal((await call(`/api/admin/workspace/pages/${record.data.id}`, 'PUT', { title: 'Help page updated', status: 'published', data: { slug: 'help', body: 'Updated.', version: 0 } }, cookie)).status, 200);
  assert.equal((await call(`/api/admin/workspace/pages/${record.data.id}`, 'PUT', { title: 'Stale', status: 'published', data: { slug: 'help', version: 0 } }, cookie)).status, 409);
  assert.equal((await call('/api/contact', 'POST', { name: 'Visitor', email: 'bad email', subject: 'Help', message: 'Hello' })).status, 400);
  const message = await call('/api/contact', 'POST', { name: 'Visitor', email: 'visitor@example.test', subject: 'Help', message: 'Please contact me.' });
  assert.equal(message.status, 201);
  assert.equal((await call('/api/admin/contact-messages', 'GET', undefined, cookie)).data.items[0].message, 'Please contact me.');
  assert.equal((await call(`/api/admin/contact-messages/${message.data.id}`, 'PATCH', { status: 'resolved' }, cookie)).status, 200);
});
test('active coupons validate, apply atomically, respect redemption caps, and release on cancellation', async () => {
  const coupon = await call('/api/admin/workspace/coupons', 'POST', { title: 'Ten percent', status: 'active', data: { code: 'SAVE10', discount_type: 'percentage', value: 10, max_redemptions: 1 } }, cookie);
  assert.equal(coupon.status, 201);
  assert.equal((await call('/api/admin/workspace/coupons', 'POST', { title: 'Duplicate code', status: 'active', data: { code: 'save10', discount_type: 'fixed', value: 500 } }, cookie)).status, 409);
  const valid = await call('/api/coupons/validate', 'POST', { code: 'save10', subtotal: 10000 });
  assert.equal(valid.status, 200);
  assert.equal(valid.data.discount, 1000);
  const subtotal = product.price;
  const created = await call('/api/orders', 'POST', { name: 'Coupon customer', phone: '555', address: 'Example', payment_proof: proof, coupon_code: 'SAVE10', expected_total: subtotal - Math.floor(subtotal / 10), items: [{ product_id: product.id, quantity: 1 }] });
  assert.equal(created.status, 201);
  const order = (await call(`/api/admin/orders/${created.data.id}`, 'GET', undefined, cookie)).data;
  assert.equal(order.discount, Math.floor(subtotal / 10));
  assert.equal(order.total, subtotal - Math.floor(subtotal / 10));
  assert.equal((await call('/api/coupons/validate', 'POST', { code: 'SAVE10', subtotal })).status, 409);
  assert.equal((await call(`/api/admin/orders/${created.data.id}`, 'PATCH', { status: 'cancelled' }, cookie)).status, 200);
  assert.equal((await call('/api/coupons/validate', 'POST', { code: 'SAVE10', subtotal })).status, 200);
});
test('store branding settings are admin-only, validated, and versioned', async () => {
  const defaults=(await call('/api/store-settings')).data;
  assert.equal(defaults.store_name,'Island Basket');
  assert.equal((await call('/api/admin/store-settings')).status,401);
  const created=await call('/api/admin/staff','POST',{username:'settingsstaff',password:'settings-staff-password',role:'staff'},cookie);
  assert.equal(created.status,201);
  const login=await call('/api/admin/login','POST',{username:'settingsstaff',password:'settings-staff-password'});
  const staffCookie=login.cookie.split(';')[0];
  assert.equal((await call('/api/admin/store-settings','GET',undefined,staffCookie)).status,403);
  const existing=await call('/api/admin/store-settings','GET',undefined,cookie);
  const input={...existing.data,store_name:'Island Market',page_title:'Island Market | Home',tagline:'Everyday essentials',support_email:'help@example.test',phone:'123',address:'Maldives',logo_url:'https://example.test/logo.png',favicon_url:'http://example.test/icon.png'};
  assert.equal((await call('/api/admin/store-settings','PUT',input,cookie)).status,400);
  input.favicon_url='https://example.test/icon.png';
  assert.equal((await call('/api/admin/store-settings','PUT',input,cookie)).status,200);
  assert.equal((await call('/api/admin/store-settings','PUT',input,cookie)).status,409);
  assert.equal((await call('/api/store-settings')).data.store_name,'Island Market');
});
