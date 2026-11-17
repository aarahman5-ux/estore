const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let server;
let base;
let temp;
let cookie;
let product;
let orderId;

async function call(url, method = 'GET', body, session) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session ? { Cookie: session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
}
before(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'island-basket-test-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: path.join(temp, 'test.sqlite'), ADMIN_PASSWORD: 'test-password' },
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
  assert.equal((await call(`/api/admin/products/${created.data.id}`, 'PUT', { ...item, stock: 7 }, cookie)).status, 200);
  const catalog = await call('/api/products');
  assert.equal(catalog.data.find(product => product.id === created.data.id).stock, 7);
});
