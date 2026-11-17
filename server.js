const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const databasePath = process.env.DB_PATH || path.join(__dirname, 'data', 'store.sqlite');
const adminPassword = process.env.ADMIN_PASSWORD || '';
const publicDir = path.join(__dirname, 'public');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price >= 0),
    original_price INTEGER CHECK(original_price IS NULL OR original_price >= price),
    stock INTEGER NOT NULL CHECK(stock >= 0),
    image TEXT NOT NULL,
    featured INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    unit_price INTEGER NOT NULL,
    quantity INTEGER NOT NULL
  );
`);

if (db.prepare('SELECT COUNT(*) AS count FROM products').get().count === 0) {
  const insert = db.prepare('INSERT INTO products (name, category, description, unit, price, original_price, stock, image, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const products = [
    ['Farm Fresh Bananas', 'Fruits & Vegetables', 'Naturally sweet bananas, perfect for breakfast and snacks.', '1 bunch', 3500, 4200, 24, 'photo-1571771894821-ce9b6c11b08e', 1],
    ['Ripe Red Tomatoes', 'Fruits & Vegetables', 'Juicy tomatoes for salads, sauces, and everyday cooking.', '500 g', 2800, null, 35, 'photo-1546094096-0df4bcaaa337', 1],
    ['Fresh Green Avocado', 'Fruits & Vegetables', 'Creamy avocados for toast, salads, and more.', '2 pieces', 5500, 6500, 18, 'photo-1523049673857-eb18f1d7b578', 1],
    ['Sweet Red Apples', 'Fruits & Vegetables', 'Crisp and refreshing apples for the whole family.', '4 pieces', 4800, null, 22, 'photo-1560806887-1e4cd0b6cbd6', 0],
    ['Fresh Whole Milk', 'Dairy & Eggs', 'Smooth whole milk for your everyday essentials.', '1 litre', 3200, 3800, 30, 'photo-1563636619-e9143da7973b', 1],
    ['Farm Fresh Eggs', 'Dairy & Eggs', 'A dozen versatile eggs for breakfast and baking.', '12 pieces', 4900, null, 40, 'photo-1506976785307-8732e854ad03', 1],
    ['Natural Greek Yogurt', 'Dairy & Eggs', 'Thick, creamy yogurt for breakfast and snacks.', '400 g', 4200, null, 14, 'photo-1488477181946-6428a0291777', 0],
    ['Jasmine Rice', 'Pantry Essentials', 'Fragrant rice, a staple for every kitchen.', '1 kg', 4500, 5200, 50, 'photo-1586201375761-83865001e31c', 1],
    ['Extra Virgin Olive Oil', 'Pantry Essentials', 'A kitchen staple for cooking and dressing.', '500 ml', 9800, null, 16, 'photo-1474979266404-7eaacbcd87c5', 0],
    ['Golden Honey', 'Pantry Essentials', 'A little natural sweetness for your pantry.', '250 g', 7500, 8500, 20, 'photo-1587049352851-8d4e89133924', 0],
    ['Fresh Orange Juice', 'Beverages', 'Bright and refreshing juice for any time of day.', '1 litre', 4500, 5200, 20, 'photo-1600271886742-f049cd451bba', 1],
    ['Coconut Water', 'Beverages', 'A refreshing tropical drink.', '330 ml', 2200, null, 32, 'photo-1600271886742-f049cd451bba', 0],
    ['Roasted Coffee Beans', 'Beverages', 'Aromatic coffee for a better morning.', '250 g', 8500, null, 12, 'photo-1559056199-641a0ac8b55e', 0],
    ['Fresh Sourdough Bread', 'Bakery', 'A delicious loaf for sandwiches and toast.', '1 loaf', 3800, null, 12, 'photo-1509440159596-0249088772ff', 1],
    ['Butter Croissants', 'Bakery', 'Flaky, buttery pastries for a lovely morning.', '4 pieces', 5500, 6200, 10, 'photo-1555507036-ab1f4038808a', 0],
    ['Fresh Watermelon', 'Fruits & Vegetables', 'Sweet and juicy watermelon for sunny days.', '1 piece', 6500, null, 8, 'photo-1563114773-84221bd62daa', 0],
    ['Raw Almonds', 'Snacks', 'A satisfying snack and pantry essential.', '200 g', 6200, null, 18, 'photo-1508061253366-f7da158b6d46', 0],
    ['Dark Chocolate', 'Snacks', 'A rich little treat to enjoy any time.', '100 g', 3800, 4500, 25, 'photo-1549007994-cb92caebd54b', 0]
  ];
  db.exec('BEGIN');
  try {
    for (const product of products) {
      product[7] = `https://images.unsplash.com/${product[7]}?auto=format&fit=crop&w=600&q=80`;
      insert.run(...product);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const sessions = new Map();
const loginAttempts = new Map();
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, label, max) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail(400, `${label} is required and must be at most ${max} characters.`);
  return value.trim();
};
const integer = (value, label, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail(400, `Invalid ${label}.`);
  return value;
};
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 65536) throw fail(413, 'Request is too large.');
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw fail(400, 'Invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail(400, 'Request must be a JSON object.');
  return parsed;
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw fail(403, 'Invalid request origin.');
}
function authorized(req) {
  const token = (req.headers.cookie || '').split('; ').find(part => part.startsWith('admin_session='))?.slice(14);
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    if (token) sessions.delete(token);
    throw fail(401, 'Please sign in as an administrator.');
  }
}
function productInput(input) {
  const price = integer(input.price, 'price', 0, 100000000);
  const originalPrice = input.original_price === null ? null : integer(input.original_price, 'original price', price, 100000000);
  const image = text(input.image, 'Image URL', 1000);
  let url;
  try { url = new URL(image); } catch { throw fail(400, 'Image must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:') throw fail(400, 'Image must be a valid HTTPS URL.');
  return [text(input.name, 'Name', 120), text(input.category, 'Category', 80), text(input.description, 'Description', 1000), text(input.unit, 'Unit', 80), price, originalPrice, integer(input.stock, 'stock', 0, 100000), image, input.featured === true ? 1 : 0];
}

async function api(req, res, url) {
  const pathname = url.pathname;
  if (req.method !== 'GET') sameOrigin(req);
  if (req.method === 'GET' && pathname === '/api/products') {
    return json(res, 200, db.prepare('SELECT * FROM products ORDER BY id').all());
  }
  if (req.method === 'POST' && pathname === '/api/orders') {
    const input = await body(req);
    const name = text(input.name, 'Name', 100);
    const phone = text(input.phone, 'Phone', 40);
    const address = text(input.address, 'Address', 500);
    const expectedTotal = integer(input.expected_total, 'order subtotal', 0, Number.MAX_SAFE_INTEGER);
    if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 500)) throw fail(400, 'Notes must be at most 500 characters.');
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw fail(400, 'Your cart must contain between 1 and 100 products.');
    const quantities = new Map();
    for (const item of input.items) {
      if (!item || typeof item !== 'object') throw fail(400, 'Invalid cart item.');
      const id = integer(item.product_id, 'product', 1, Number.MAX_SAFE_INTEGER);
      const quantity = integer(item.quantity, 'quantity', 1, 100);
      const total = (quantities.get(id) || 0) + quantity;
      if (total > 100) throw fail(400, 'Maximum quantity per product is 100.');
      quantities.set(id, total);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const items = [];
      let total = 0;
      for (const [id, quantity] of quantities) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!product || product.stock < quantity) throw fail(409, `${product?.name || 'A product'} is no longer available in the requested quantity.`);
        total += product.price * quantity;
        items.push({ product, quantity });
      }
      if (total !== expectedTotal) throw fail(409, 'Prices have changed. Please review your updated basket before ordering.');
      const order = db.prepare('INSERT INTO orders (customer_name, phone, address, notes, total) VALUES (?, ?, ?, ?, ?)').run(name, phone, address, (input.notes || '').trim(), total);
      const addItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)');
      const reduceStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
      for (const { product, quantity } of items) {
        addItem.run(order.lastInsertRowid, product.id, product.name, product.price, quantity);
        reduceStock.run(quantity, product.id);
      }
      db.exec('COMMIT');
      return json(res, 201, { id: Number(order.lastInsertRowid), total });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (req.method === 'POST' && pathname === '/api/admin/login') {
    if (!adminPassword) throw fail(503, 'Admin access is not configured. Set ADMIN_PASSWORD before starting the server.');
    const key = req.socket.remoteAddress;
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.until > Date.now() && attempt.count >= 5) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
    const input = await body(req);
    const supplied = typeof input.password === 'string' ? input.password : '';
    const expectedHash = crypto.createHash('sha256').update(adminPassword).digest();
    const suppliedHash = crypto.createHash('sha256').update(supplied).digest();
    if (!crypto.timingSafeEqual(expectedHash, suppliedHash)) {
      const current = attempt && attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + 15 * 60 * 1000 };
      current.count++;
      loginAttempts.set(key, current);
      throw fail(401, 'Incorrect password.');
    }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
    const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
    return json(res, 200, { ok: true });
  }
  if (pathname.startsWith('/api/admin/')) {
    authorized(req);
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      const token = (req.headers.cookie || '').split('; ').find(part => part.startsWith('admin_session='))?.slice(14);
      sessions.delete(token);
      res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/admin/orders') {
      const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
      const items = db.prepare('SELECT name, unit_price, quantity FROM order_items WHERE order_id = ?');
      return json(res, 200, orders.map(order => ({ ...order, items: items.all(order.id) })));
    }
    if (req.method === 'POST' && pathname === '/api/admin/products') {
      const values = productInput(await body(req));
      const result = db.prepare('INSERT INTO products (name, category, description, unit, price, original_price, stock, image, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...values);
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    }
    const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
    if (req.method === 'PUT' && productMatch) {
      const values = productInput(await body(req));
      const result = db.prepare('UPDATE products SET name=?, category=?, description=?, unit=?, price=?, original_price=?, stock=?, image=?, featured=? WHERE id=?').run(...values, Number(productMatch[1]));
      if (!result.changes) throw fail(404, 'Product not found.');
      return json(res, 200, { ok: true });
    }
    const orderMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (req.method === 'PATCH' && orderMatch) {
      const input = await body(req);
      if (!['pending', 'confirmed', 'preparing', 'out for delivery', 'delivered', 'cancelled'].includes(input.status)) throw fail(400, 'Invalid order status.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const order = db.prepare('SELECT status FROM orders WHERE id=?').get(Number(orderMatch[1]));
        if (!order) throw fail(404, 'Order not found.');
        if (order.status === 'cancelled' && input.status !== 'cancelled') throw fail(409, 'Cancelled orders cannot be reopened. Create a new order instead.');
        if (order.status !== 'cancelled' && input.status === 'cancelled') {
          const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id=?').all(Number(orderMatch[1]));
          const restore = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
          for (const item of items) restore.run(item.quantity, item.product_id);
        }
        db.prepare('UPDATE orders SET status=? WHERE id=?').run(input.status, Number(orderMatch[1]));
        db.exec('COMMIT');
        return json(res, 200, { ok: true });
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  }
  throw fail(404, 'Not found.');
}

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8']
};
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = files[url.pathname];
    if (req.method !== 'GET' || !file) throw fail(404, 'Not found.');
    res.writeHead(200, {
      'Content-Type': file[1],
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(fs.readFileSync(path.join(publicDir, file[0])));
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
    else res.end();
  }
}).listen(port, host, () => {
  console.log(`Island Basket is running at http://${host}:${port}`);
  if (!adminPassword) console.warn('ADMIN_PASSWORD is not set; admin access is disabled.');
});
