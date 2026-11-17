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
  const catalog = await call('/api/products');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.data.length > 0);
  product = catalog.data[0];
  assert.equal((await call('/api/admin/orders')).status, 401);
  assert.equal((await call('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
  const login = await call('/api/admin/login', 'POST', { password: 'test-password' });
  assert.equal(login.status, 200);
  cookie = login.cookie.split(';')[0];
});
test('checkout uses server prices, updates stock, and rejects invalid orders', async () => {
  const payload = { name: 'Test customer', phone: '1234567', address: 'Test island', expected_total: product.price * 2, items: [{ product_id: product.id, quantity: 2, price: 1 }] };
  assert.equal((await call('/api/orders', 'POST', { ...payload, expected_total: 1 })).status, 409);
  const order = await call('/api/orders', 'POST', payload);
  assert.equal(order.status, 201);
  assert.equal(order.data.total, product.price * 2);
  orderId = order.data.id;
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
    legacy.exec("PRAGMA foreign_keys=ON; CREATE TABLE products (id INTEGER PRIMARY KEY); INSERT INTO products VALUES (1); CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT); INSERT INTO orders VALUES (12, 'delivered', '2026-01-01 10:00:00');");
    migrate(legacy, 'legacy-password');
    assert.equal(legacy.prepare('PRAGMA user_version').get().user_version, 2);
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
    existing.exec("CREATE TABLE products (id INTEGER PRIMARY KEY); INSERT INTO products VALUES (1); CREATE TABLE staff_users (id INTEGER PRIMARY KEY); INSERT INTO staff_users VALUES (1); PRAGMA user_version = 1;");
    migrate(existing, 'ignored-bootstrap-password');
    assert.equal(existing.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(existing.prepare('SELECT version FROM products WHERE id=1').get().version, 0);
    assert.equal(existing.prepare('SELECT COUNT(*) AS count FROM staff_users').get().count, 1);
  } finally { existing.close(); }
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
test('sessions survive restart and bootstrap password does not reset existing accounts', async () => {
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await exited;
  await startServer('different-bootstrap-password');
  assert.equal((await call('/api/admin/me', 'GET', undefined, cookie)).status, 200);
  assert.equal((await call('/api/admin/login', 'POST', { username: 'admin', password: 'different-bootstrap-password' })).status, 401);
  assert.equal((await call('/api/admin/login', 'POST', { username: 'admin', password: 'test-password' })).status, 200);
});
