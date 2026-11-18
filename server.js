const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { migrate, newPassword, passwordHash } = require('./lib/database');
const { createBackupManager } = require('./lib/backups');

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
  PRAGMA busy_timeout = 5000;
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

migrate(db, adminPassword);
const backups = createBackupManager(db, process.env.BACKUP_DIR || path.join(path.dirname(databasePath), 'backups'));
backups.start();

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
async function body(req, limit = 65536) {
  let raw = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > limit) throw fail(413, 'Request is too large.');
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
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw fail(401, 'Please sign in.');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const user = db.prepare(`SELECT u.id, u.username, u.role FROM staff_sessions s
    JOIN staff_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(hash, Date.now());
  if (!user) throw fail(401, 'Please sign in.');
  return { ...user, sessionHash: hash };
}
function requireAdmin(user) {
  if (user.role !== 'admin') throw fail(403, 'Administrator access is required.');
}
function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(value)) throw fail(400, 'Username must be 3–32 letters, numbers, dots, underscores or hyphens.');
  return value;
}
function verifyPassword(password, user) {
  const salt = user?.password_salt || '00000000000000000000000000000000';
  const expected = Buffer.from(user?.password_hash || '0'.repeat(128), 'hex');
  const actual = Buffer.from(passwordHash(password, salt), 'hex');
  return crypto.timingSafeEqual(expected, actual) && Boolean(user);
}
function paging(url) {
  const parse = (name, fallback, max) => {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) throw fail(400, `Invalid ${name}.`);
    return integer(Number(raw), name, name === 'limit' ? 1 : 0, max);
  };
  return { limit: parse('limit', 25, 100), offset: parse('offset', 0, 1000000) };
}
function searchTerm(url) {
  const value = (url.searchParams.get('q') || '').trim();
  if (value.length > 100) throw fail(400, 'Search must be at most 100 characters.');
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
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
function variantInput(input) {
  return [text(input.name, 'Variant name', 80), integer(input.price, 'price', 0, 100000000), integer(input.stock, 'stock', 0, 100000)];
}
function optionalText(value, label, max) {
  if (typeof value !== 'string' || value.trim().length > max) throw fail(400, `${label} must be at most ${max} characters.`);
  return value.trim();
}
function optionalHttps(value,label,max){
  const result=optionalText(value,label,max);
  if(!result)return '';
  let url;
  try{url=new URL(result);}catch{throw fail(400,`${label} must be a valid HTTPS URL.`);}
  if(url.protocol!=='https:') throw fail(400,`${label} must be a valid HTTPS URL.`);
  return result;
}
function paymentProof(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(5 * 1024 * 1024 / 3) * 4 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) throw fail(400, 'Upload a JPG, PNG, or PDF slip no larger than 5 MB.');
  const content = Buffer.from(value, 'base64');
  if (!content.length || content.length > 5 * 1024 * 1024 || content.toString('base64') !== value) throw fail(400, 'Upload a JPG, PNG, or PDF slip no larger than 5 MB.');
  let type;
  if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) type = 'png';
  else if (content.length >= 3 && content[0] === 255 && content[1] === 216 && content[2] === 255) type = 'jpg';
  else if (content.subarray(0, 5).equals(Buffer.from('%PDF-'))) type = 'pdf';
  else throw fail(400, 'Upload a JPG, PNG, or PDF slip.');
  return { content, type };
}
const workspaceModules = new Set([
  'brands', 'collections', 'attributes', 'tags', 'reviews', 'coupons', 'promotions',
  'gift_cards', 'campaigns', 'navigation', 'pages', 'blog_posts', 'blog_categories',
  'testimonials', 'testimonial_categories', 'popups', 'faqs', 'email_templates',
  'email_drafts', 'notifications', 'media', 'teams', 'roles', 'permissions',
  'integrations', 'webhooks', 'settings'
]);
function workspaceInput(input) {
  const title = text(input.title, 'Title', 160);
  const status = input.status === undefined ? 'draft' : text(input.status, 'Status', 32);
  const data = input.data === undefined ? {} : input.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Details must be a JSON object.');
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized) > 10000) throw fail(413, 'Record details must be at most 10 KB.');
  return { title, status, serialized, data };
}
function couponFor(code) {
  const record=db.prepare("SELECT id,title,status,data FROM workspace_records WHERE module='coupons' AND status='active'").all()
    .find(item => String(JSON.parse(item.data).code || '').toUpperCase() === code.toUpperCase());
  if(!record) throw fail(400,'Coupon code is invalid or inactive.');
  const data=JSON.parse(record.data);
  const now=Date.now();
  if(data.expires_at && (!Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at)<now)) throw fail(400,'Coupon has expired.');
  const limit=data.max_redemptions;
  const redeemed=db.prepare('SELECT COUNT(*) AS count FROM coupon_redemptions WHERE coupon_id=?').get(record.id).count;
  if(limit!=null && (!Number.isSafeInteger(limit) || limit<1 || redeemed>=limit)) throw fail(409,'Coupon redemption limit has been reached.');
  const type=data.discount_type;
  const value=data.value;
  if(!['percentage','fixed'].includes(type) || !Number.isSafeInteger(value) || value<1 || (type==='percentage' && value>100)) throw fail(400,'Coupon configuration is invalid.');
  const minimum=data.min_subtotal===undefined?0:data.min_subtotal;
  if(!Number.isSafeInteger(minimum) || minimum<0) throw fail(400,'Coupon configuration is invalid.');
  return {record,code:String(data.code).toUpperCase(),type,value,minimum};
}
function couponDiscount(coupon, subtotal) {
  if(subtotal<coupon.minimum) throw fail(400,'Order subtotal does not meet the coupon minimum.');
  return coupon.type==='percentage'?Math.floor(subtotal*coupon.value/100):Math.min(subtotal,coupon.value);
}

async function api(req, res, url) {
  const pathname = url.pathname;
  if (req.method !== 'GET') sameOrigin(req);
  if (req.method === 'GET' && pathname === '/api/products') {
    const variants = db.prepare('SELECT id, name, price, stock FROM product_variants WHERE product_id=? ORDER BY name COLLATE NOCASE, id');
    return json(res, 200, db.prepare('SELECT * FROM products ORDER BY id').all().map(product => ({ ...product, variants: variants.all(product.id) })));
  }
  if (req.method === 'GET' && pathname === '/api/payment-settings') {
    const settings = db.prepare('SELECT bank_name, account_name, account_number, instructions FROM bank_settings WHERE id=1').get();
    return json(res, 200, settings || null);
  }
  if(req.method==='GET' && pathname==='/api/store-settings'){
    const settings=db.prepare('SELECT store_name,page_title,tagline,support_email,phone,address,logo_url,favicon_url FROM store_settings WHERE id=1').get();
    return json(res,200,settings);
  }
  if(req.method==='POST' && pathname==='/api/coupons/validate'){
    const input=await body(req);
    const code=text(input.code,'Coupon code',80).toUpperCase();
    const subtotal=integer(input.subtotal,'subtotal',0,Number.MAX_SAFE_INTEGER);
    const coupon=couponFor(code);
    const discount=couponDiscount(coupon,subtotal);
    return json(res,200,{code:coupon.code,discount,total:subtotal-discount});
  }
  if (req.method === 'POST' && pathname === '/api/contact') {
    const input = await body(req);
    const name = text(input.name, 'Name', 100);
    const email = input.email === undefined ? '' : optionalText(input.email, 'Email', 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
    const phone = input.phone === undefined ? '' : optionalText(input.phone, 'Phone', 40);
    const subject = text(input.subject, 'Subject', 160);
    const message = text(input.message, 'Message', 5000);
    const result = db.prepare('INSERT INTO contact_messages (name,email,phone,subject,message) VALUES (?,?,?,?,?)').run(name,email,phone,subject,message);
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  }
  const contentMatch = pathname.match(/^\/api\/content\/(pages|blog_posts|faqs)\/([a-z0-9-]{1,120})$/);
  if (req.method === 'GET' && contentMatch) {
    const record = db.prepare("SELECT title, data FROM workspace_records WHERE module=? AND status='published' AND json_extract(data, '$.slug')=?").get(contentMatch[1], contentMatch[2]);
    if (!record) throw fail(404, 'Published content not found.');
    return json(res, 200, { title: record.title, ...JSON.parse(record.data) });
  }
  if (req.method === 'POST' && pathname === '/api/orders') {
    const input = await body(req, 7100000);
    if (!db.prepare('SELECT id FROM bank_settings WHERE id=1').get()) throw fail(503, 'Bank transfer is not configured. Please contact the store.');
    const proof = paymentProof(input.payment_proof);
    const name = text(input.name, 'Name', 100);
    const phone = text(input.phone, 'Phone', 40);
    const address = text(input.address, 'Address', 500);
    const expectedTotal = integer(input.expected_total, 'order subtotal', 0, Number.MAX_SAFE_INTEGER);
    const couponCode=input.coupon_code===undefined?'':optionalText(input.coupon_code,'Coupon code',80).toUpperCase();
    if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 500)) throw fail(400, 'Notes must be at most 500 characters.');
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw fail(400, 'Your cart must contain between 1 and 100 products.');
    const quantities = new Map();
    for (const item of input.items) {
      if (!item || typeof item !== 'object') throw fail(400, 'Invalid cart item.');
      const id = integer(item.product_id, 'product', 1, Number.MAX_SAFE_INTEGER);
      const quantity = integer(item.quantity, 'quantity', 1, 100);
      const variantId = item.variant_id == null ? null : integer(item.variant_id, 'variant', 1, Number.MAX_SAFE_INTEGER);
      const key = `${id}:${variantId || 0}`;
      const total = (quantities.get(key)?.quantity || 0) + quantity;
      if (total > 100) throw fail(400, 'Maximum quantity per product is 100.');
      quantities.set(key, { id, variantId, quantity: total });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const items = [];
      let total = 0;
      for (const { id, variantId, quantity } of quantities.values()) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        const variant = variantId ? db.prepare('SELECT * FROM product_variants WHERE id=? AND product_id=?').get(variantId, id) : null;
        if (!product || (variantId && !variant) || (variant || product).stock < quantity) throw fail(409, `${product?.name || 'A product'} is no longer available in the requested quantity.`);
        total += (variant || product).price * quantity;
        items.push({ product, variant, quantity });
      }
      const coupon=couponCode?couponFor(couponCode):null;
      const discount=coupon?couponDiscount(coupon,total):0;
      if (total-discount !== expectedTotal) throw fail(409, 'Prices or discounts have changed. Please review your updated basket before ordering.');
      const order = db.prepare("INSERT INTO orders (customer_name, phone, address, notes, total, discount, payment_status) VALUES (?, ?, ?, ?, ?, ?, 'awaiting_verification')").run(name, phone, address, (input.notes || '').trim(), total-discount, discount);
      db.prepare('INSERT INTO order_history (order_id, status, actor) VALUES (?, ?, ?)').run(order.lastInsertRowid, 'pending', 'Customer');
      db.prepare('INSERT INTO payment_proofs (order_id, file_type, content) VALUES (?, ?, ?)').run(order.lastInsertRowid, proof.type, proof.content);
      db.prepare('INSERT INTO payment_history (order_id, status, actor) VALUES (?, ?, ?)').run(order.lastInsertRowid, 'awaiting_verification', 'Customer');
      if(coupon) db.prepare('INSERT INTO coupon_redemptions(coupon_id,order_id,code,discount) VALUES(?,?,?,?)').run(coupon.record.id,order.lastInsertRowid,coupon.code,discount);
      const addItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, variant_id) VALUES (?, ?, ?, ?, ?, ?)');
      const reduceStock = db.prepare('UPDATE products SET stock = stock - ?, version = version + 1 WHERE id = ?');
      const reduceVariant = db.prepare('UPDATE product_variants SET stock=stock-?, version=version+1 WHERE id=?');
      const touchProduct = db.prepare('UPDATE products SET version=version+1 WHERE id=?');
      for (const { product, variant, quantity } of items) {
        addItem.run(order.lastInsertRowid, product.id, variant ? `${product.name} - ${variant.name}` : product.name, (variant || product).price, quantity, variant?.id || null);
        if (variant) { reduceVariant.run(quantity, variant.id); touchProduct.run(product.id); }
        else reduceStock.run(quantity, product.id);
      }
      db.exec('COMMIT');
      return json(res, 201, { id: Number(order.lastInsertRowid), total });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (req.method === 'POST' && pathname === '/api/admin/login') {
    if (db.prepare('SELECT COUNT(*) AS count FROM staff_users').get().count === 0) throw fail(503, 'Admin access is not configured. Set ADMIN_PASSWORD before starting the server.');
    const key = req.socket.remoteAddress;
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.until > Date.now() && attempt.count >= 5) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
    const input = await body(req);
    const supplied = typeof input.password === 'string' && input.password.length <= 256 ? input.password : '';
    const loginName = typeof input.username === 'string' && input.username.length <= 32 ? input.username : 'admin';
    const user = db.prepare('SELECT * FROM staff_users WHERE username=? COLLATE NOCASE AND active=1').get(loginName);
    if (!verifyPassword(supplied, user)) {
      const current = attempt && attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + 15 * 60 * 1000 };
      current.count++;
      loginAttempts.set(key, current);
      throw fail(401, 'Incorrect username or password.');
    }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM staff_sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO staff_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), user.id, Date.now() + 8 * 60 * 60 * 1000);
    const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
    return json(res, 200, { ok: true });
  }
  if (pathname.startsWith('/api/admin/')) {
    const user = authorized(req);
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      db.prepare('DELETE FROM staff_sessions WHERE token_hash=?').run(user.sessionHash);
      res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/admin/me') {
      return json(res, 200, { id: user.id, username: user.username, role: user.role });
    }
    if (req.method === 'POST' && pathname === '/api/admin/password') {
      const input = await body(req);
      const current = db.prepare('SELECT * FROM staff_users WHERE id=?').get(user.id);
      if (typeof input.current_password !== 'string' || input.current_password.length > 256 || !verifyPassword(input.current_password, current)) throw fail(400, 'Current password is incorrect.');
      const password = newPassword(input.new_password);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE staff_users SET password_hash=?, password_salt=? WHERE id=?').run(password.hash, password.salt, user.id);
        db.prepare('DELETE FROM staff_sessions WHERE user_id=?').run(user.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/bank-settings' && req.method === 'GET') {
      requireAdmin(user);
      return json(res, 200, db.prepare('SELECT bank_name, account_name, account_number, instructions FROM bank_settings WHERE id=1').get() || null);
    }
    if(pathname==='/api/admin/store-settings' && req.method==='GET'){
      requireAdmin(user);
      return json(res,200,db.prepare('SELECT store_name,page_title,tagline,support_email,phone,address,logo_url,favicon_url,version FROM store_settings WHERE id=1').get());
    }
    if(pathname==='/api/admin/store-settings' && req.method==='PUT'){
      requireAdmin(user);
      const input=await body(req);
      const values=[
        text(input.store_name,'Store name',120),
        text(input.page_title,'Browser title',160),
        text(input.tagline,'Tagline',240),
        optionalText(input.support_email,'Support email',160),
        optionalText(input.phone,'Phone',40),
        optionalText(input.address,'Address',300),
        optionalHttps(input.logo_url,'Logo URL',1000),
        optionalHttps(input.favicon_url,'Favicon URL',1000)
      ];
      const version=integer(input.version,'settings version',0,Number.MAX_SAFE_INTEGER);
      const result=db.prepare(`UPDATE store_settings SET store_name=?,page_title=?,tagline=?,support_email=?,phone=?,address=?,logo_url=?,favicon_url=?,version=version+1 WHERE id=1 AND version=?`).run(...values,version);
      if(!result.changes)throw fail(409,'Store settings changed. Refresh and try again.');
      return json(res,200,{ok:true});
    }
    if (pathname === '/api/admin/bank-settings' && req.method === 'PUT') {
      requireAdmin(user);
      const input = await body(req);
      const bank = text(input.bank_name, 'Bank name', 120);
      const account = text(input.account_name, 'Account name', 120);
      const number = text(input.account_number, 'Account number', 120);
      const instructions = optionalText(input.instructions, 'Instructions', 500);
      db.prepare(`INSERT INTO bank_settings (id, bank_name, account_name, account_number, instructions) VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET bank_name=excluded.bank_name, account_name=excluded.account_name, account_number=excluded.account_number, instructions=excluded.instructions`).run(bank, account, number, instructions);
      return json(res, 200, { ok: true });
    }
    const workspaceMatch = pathname.match(/^\/api\/admin\/workspace\/([a-z_]+)(?:\/(\d+))?$/);
    if (workspaceMatch) {
      const [, module, id] = workspaceMatch;
      if (!workspaceModules.has(module)) throw fail(404, 'Workspace module not found.');
      requireAdmin(user);
      if (req.method === 'GET' && !id) {
        const { limit, offset } = paging(url);
        const term = searchTerm(url);
        const total = db.prepare("SELECT COUNT(*) AS count FROM workspace_records WHERE module=? AND (title LIKE ? ESCAPE '\\')").get(module, term).count;
        const records = db.prepare(`SELECT id,module,title,status,data,version,created_at,updated_at FROM workspace_records
          WHERE module=? AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(module, term, limit, offset);
        return json(res, 200, { items: records.map(item => ({ ...item, data: JSON.parse(item.data) })), total, limit, offset });
      }
      if (req.method === 'POST' && !id) {
        const input = workspaceInput(await body(req));
        if (input.data.slug && db.prepare("SELECT id FROM workspace_records WHERE module=? AND json_extract(data,'$.slug')=?").get(module,input.data.slug)) throw fail(409, 'That slug is already in use in this module.');
        if(module==='coupons' && input.data.code && db.prepare("SELECT id FROM workspace_records WHERE module='coupons' AND upper(json_extract(data,'$.code'))=upper(?)").get(String(input.data.code))) throw fail(409,'Coupon code is already in use.');
        const result = db.prepare('INSERT INTO workspace_records (module,title,status,data) VALUES (?,?,?,?)').run(module,input.title,input.status,input.serialized);
        return json(res, 201, { id: Number(result.lastInsertRowid) });
      }
      if (req.method === 'PUT' && id) {
        const input = workspaceInput(await body(req));
        const version = integer(input.data.version, 'record version', 0, Number.MAX_SAFE_INTEGER);
        if (input.data.slug && db.prepare("SELECT id FROM workspace_records WHERE module=? AND json_extract(data,'$.slug')=? AND id!=?").get(module,input.data.slug,Number(id))) throw fail(409, 'That slug is already in use in this module.');
        if(module==='coupons' && input.data.code && db.prepare("SELECT id FROM workspace_records WHERE module='coupons' AND upper(json_extract(data,'$.code'))=upper(?) AND id!=?").get(String(input.data.code),Number(id))) throw fail(409,'Coupon code is already in use.');
        delete input.data.version;
        input.serialized = JSON.stringify(input.data);
        const result = db.prepare("UPDATE workspace_records SET title=?,status=?,data=?,version=version+1,updated_at=datetime('now') WHERE module=? AND id=? AND version=?")
          .run(input.title,input.status,input.serialized,module,Number(id),version);
        if (!result.changes) {
          if (!db.prepare('SELECT id FROM workspace_records WHERE module=? AND id=?').get(module,Number(id))) throw fail(404, 'Record not found.');
          throw fail(409, 'This record changed. Refresh it before saving.');
        }
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && id) {
        const result = db.prepare('DELETE FROM workspace_records WHERE module=? AND id=?').run(module,Number(id));
        if (!result.changes) throw fail(404, 'Record not found.');
        return json(res, 200, { ok: true });
      }
    }
    if (pathname === '/api/admin/contact-messages' && req.method === 'GET') {
      requireAdmin(user);
      requireAdmin(user);
      const { limit, offset } = paging(url);
      const total = db.prepare('SELECT COUNT(*) AS count FROM contact_messages').get().count;
      return json(res, 200, { items: db.prepare('SELECT id,name,email,phone,subject,message,status,created_at FROM contact_messages ORDER BY id DESC LIMIT ? OFFSET ?').all(limit,offset), total });
    }
    const contactMatch = pathname.match(/^\/api\/admin\/contact-messages\/(\d+)$/);
    if (contactMatch && req.method === 'PATCH') {
      requireAdmin(user);
      requireAdmin(user);
      const input = await body(req);
      if (!['new','open','resolved','spam'].includes(input.status)) throw fail(400, 'Invalid message status.');
      const result = db.prepare('UPDATE contact_messages SET status=? WHERE id=?').run(input.status,Number(contactMatch[1]));
      if (!result.changes) throw fail(404, 'Message not found.');
      return json(res,200,{ok:true});
    }
    if (pathname === '/api/admin/customers' && req.method === 'GET') {
      const { limit, offset } = paging(url);
      const term = searchTerm(url);
      const where = "WHERE customer_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\'";
      const total = db.prepare(`SELECT COUNT(DISTINCT phone) AS count FROM orders ${where}`).get(term,term).count;
      const items = db.prepare(`SELECT phone, MAX(customer_name) AS customer_name, MAX(address) AS latest_address,
        COUNT(*) AS order_count, SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered_count,
        SUM(CASE WHEN status!='cancelled' THEN total ELSE 0 END) AS order_subtotal,
        MAX(created_at) AS last_order
        FROM orders ${where} GROUP BY phone ORDER BY last_order DESC LIMIT ? OFFSET ?`).all(term,term,limit,offset);
      return json(res,200,{items,total,limit,offset});
    }
    if (pathname === '/api/admin/reports' && req.method === 'GET') {
      const report = url.searchParams.get('type') || 'sales';
      if (!['sales','orders','products','inventory','customers','returns','payments'].includes(report)) throw fail(400,'Unknown report type.');
      if (report === 'sales') return json(res,200,db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS order_count,
        SUM(CASE WHEN status!='cancelled' THEN total ELSE 0 END) AS order_subtotal,
        SUM(CASE WHEN payment_status='verified' AND status!='cancelled' THEN total ELSE 0 END) AS verified_bank_subtotal
        FROM orders WHERE date(created_at)>=date('now','-89 days') GROUP BY date(created_at) ORDER BY day`).all());
      if (report === 'orders') return json(res,200,db.prepare('SELECT status,COUNT(*) AS count,SUM(total) AS subtotal FROM orders GROUP BY status ORDER BY status').all());
      if (report === 'products') return json(res,200,db.prepare(`SELECT p.id,p.name,p.category,SUM(i.quantity) AS units_sold,
        SUM(i.quantity*i.unit_price) AS ordered_subtotal FROM products p JOIN order_items i ON i.product_id=p.id
        JOIN orders o ON o.id=i.order_id WHERE o.status!='cancelled' GROUP BY p.id ORDER BY units_sold DESC,p.name LIMIT 100`).all());
      if (report === 'inventory') return json(res,200,{products:db.prepare('SELECT COUNT(*) AS count,SUM(stock) AS units FROM products').get(),low_products:db.prepare('SELECT id,name,stock FROM products WHERE stock<=5 ORDER BY stock,name').all(),variants:db.prepare('SELECT COUNT(*) AS count,SUM(stock) AS units FROM product_variants').get(),low_variants:db.prepare('SELECT p.name AS product,v.name,v.stock FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.stock<=5 ORDER BY v.stock').all()});
      if (report === 'customers') return json(res,200,db.prepare(`SELECT COUNT(DISTINCT phone) AS customers,
        COUNT(DISTINCT CASE WHEN order_count>1 THEN phone END) AS returning_customers FROM
        (SELECT phone,COUNT(*) AS order_count FROM orders GROUP BY phone)`).get());
      if (report === 'returns') return json(res,200,db.prepare('SELECT status,COUNT(*) AS count FROM returns GROUP BY status ORDER BY status').all());
      return json(res,200,db.prepare('SELECT payment_status,COUNT(*) AS count,SUM(total) AS subtotal FROM orders GROUP BY payment_status ORDER BY payment_status').all());
    }
    if (pathname === '/api/admin/returns' && req.method === 'GET') {
      const { limit, offset } = paging(url);
      const total = db.prepare('SELECT COUNT(*) AS count FROM returns').get().count;
      const items = db.prepare(`SELECT r.*,o.customer_name,o.total AS order_total,
        COALESCE((SELECT SUM(amount) FROM refunds f WHERE f.return_id=r.id),0) AS refunded
        FROM returns r JOIN orders o ON o.id=r.order_id ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(limit,offset);
      return json(res,200,{items,total,limit,offset});
    }
    if (pathname === '/api/admin/returns' && req.method === 'POST') {
      const input = await body(req);
      const orderId = integer(input.order_id,'order',1,Number.MAX_SAFE_INTEGER);
      const reason = text(input.reason,'Reason',500);
      if (!Array.isArray(input.items) || input.items.length<1 || input.items.length>50) throw fail(400,'Select between 1 and 50 order items.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const order=db.prepare('SELECT status FROM orders WHERE id=?').get(orderId);
        if (!order) throw fail(404,'Order not found.');
        if (order.status!=='delivered') throw fail(409,'Only delivered orders can be returned.');
        const result=db.prepare("INSERT INTO returns(order_id,status,reason,actor) VALUES(?,'requested',?,?)").run(orderId,reason,user.username);
        const insert=db.prepare('INSERT INTO return_items(return_id,order_item_id,name,quantity,unit_price) VALUES(?,?,?,?,?)');
        for (const item of input.items) {
          const itemId=integer(item.order_item_id,'order item',1,Number.MAX_SAFE_INTEGER);
          const quantity=integer(item.quantity,'quantity',1,100000);
          const purchased=db.prepare('SELECT id,name,quantity,unit_price FROM order_items WHERE id=? AND order_id=?').get(itemId,orderId);
          if (!purchased) throw fail(400,'An item does not belong to this order.');
          const previously=db.prepare(`SELECT COALESCE(SUM(ri.quantity),0) AS quantity FROM return_items ri
            JOIN returns r ON r.id=ri.return_id WHERE ri.order_item_id=? AND r.status!='rejected'`).get(itemId).quantity;
          if (previously+quantity>purchased.quantity) throw fail(409,'Return quantity exceeds the remaining purchased quantity.');
          insert.run(Number(result.lastInsertRowid),itemId,purchased.name,quantity,purchased.unit_price);
        }
        db.exec('COMMIT');
        return json(res,201,{id:Number(result.lastInsertRowid)});
      } catch(error){db.exec('ROLLBACK');throw error;}
    }
    const returnMatch=pathname.match(/^\/api\/admin\/returns\/(\d+)$/);
    if(returnMatch && req.method==='GET'){
      const record=db.prepare('SELECT r.*,o.customer_name,o.total AS order_total FROM returns r JOIN orders o ON o.id=r.order_id WHERE r.id=?').get(Number(returnMatch[1]));
      if(!record) throw fail(404,'Return not found.');
      const items=db.prepare('SELECT * FROM return_items WHERE return_id=?').all(record.id);
      const refunds=db.prepare('SELECT * FROM refunds WHERE return_id=? ORDER BY id').all(record.id);
      return json(res,200,{...record,items,refunds});
    }
    if(returnMatch && req.method==='PATCH'){
      const input=await body(req);
      if(!['approved','rejected','received'].includes(input.status)) throw fail(400,'Invalid return status.');
      db.exec('BEGIN IMMEDIATE');
      try{
        const record=db.prepare('SELECT status FROM returns WHERE id=?').get(Number(returnMatch[1]));
        if(!record) throw fail(404,'Return not found.');
        if(record.status==='rejected' || record.status==='received') throw fail(409,'This return can no longer be changed.');
        if(input.status==='received' && record.status!=='approved') throw fail(409,'Approve the return before marking it received.');
        if(input.status==='received'){
          const items=db.prepare(`SELECT ri.quantity,ri.order_item_id,oi.product_id,oi.variant_id FROM return_items ri
            JOIN order_items oi ON oi.id=ri.order_item_id WHERE ri.return_id=?`).all(Number(returnMatch[1]));
          for(const item of items){
            if(item.variant_id){db.prepare('UPDATE product_variants SET stock=stock+?,version=version+1 WHERE id=?').run(item.quantity,item.variant_id); db.prepare('UPDATE products SET version=version+1 WHERE id=?').run(item.product_id);}
            else db.prepare('UPDATE products SET stock=stock+?,version=version+1 WHERE id=?').run(item.quantity,item.product_id);
            db.prepare('UPDATE return_items SET restocked=1 WHERE return_id=? AND order_item_id=?').run(Number(returnMatch[1]),item.order_item_id);
            db.prepare('INSERT INTO stock_adjustments(product_id,variant_id,delta,reason,actor) VALUES(?,?,?,?,?)').run(item.product_id,item.variant_id,item.quantity,`Return #${returnMatch[1]} received`,user.username);
          }
        }
        db.prepare("UPDATE returns SET status=?,staff_note=?,updated_at=datetime('now') WHERE id=?").run(input.status,input.staff_note===undefined?'':optionalText(input.staff_note,'Staff note',500),Number(returnMatch[1]));
        db.exec('COMMIT');
        return json(res,200,{ok:true});
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    const refundMatch=pathname.match(/^\/api\/admin\/returns\/(\d+)\/refunds$/);
    if(refundMatch && req.method==='POST'){
      const input=await body(req);
      const amount=integer(input.amount,'refund amount',1,100000000);
      const reference=text(input.reference,'Manual transfer reference',120);
      const note=input.note===undefined?'':optionalText(input.note,'Note',500);
      const returnId=Number(refundMatch[1]);
      db.exec('BEGIN IMMEDIATE');
      try{
        const record=db.prepare(`SELECT r.status,r.order_id,o.total AS order_total,
          COALESCE((SELECT SUM(amount) FROM refunds WHERE return_id=r.id),0) AS refunded,
          COALESCE((SELECT SUM(f.amount) FROM refunds f JOIN returns other ON other.id=f.return_id WHERE other.order_id=r.order_id),0) AS order_refunded,
          (SELECT SUM(ri.quantity*ri.unit_price) FROM return_items ri WHERE ri.return_id=r.id) AS return_value
          FROM returns r JOIN orders o ON o.id=r.order_id WHERE r.id=?`).get(returnId);
        if(!record) throw fail(404,'Return not found.');
        if(record.status!=='received') throw fail(409,'Mark the approved items received before recording a refund.');
        if(record.refunded+amount>record.return_value || record.order_refunded+amount>record.order_total) throw fail(400,'Refund exceeds the remaining eligible order value.');
        db.prepare("INSERT INTO refunds(return_id,amount,method,reference,note,actor) VALUES(?,?,'manual bank transfer',?,?,?)").run(returnId,amount,reference,note,user.username);
        db.exec('COMMIT');
        return json(res,201,{ok:true});
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    if(pathname==='/api/admin/stock-adjustments' && req.method==='GET'){
      const {limit,offset}=paging(url);
      const total=db.prepare('SELECT COUNT(*) AS count FROM stock_adjustments').get().count;
      const items=db.prepare(`SELECT a.*,p.name AS product_name,v.name AS variant_name FROM stock_adjustments a
        JOIN products p ON p.id=a.product_id LEFT JOIN product_variants v ON v.id=a.variant_id ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(limit,offset);
      return json(res,200,{items,total,limit,offset});
    }
    if(pathname==='/api/admin/stock-adjustments' && req.method==='POST'){
      const input=await body(req);
      const productId=integer(input.product_id,'product',1,Number.MAX_SAFE_INTEGER);
      const variantId=input.variant_id==null?null:integer(input.variant_id,'variant',1,Number.MAX_SAFE_INTEGER);
      const delta=integer(input.delta,'stock adjustment',-100000,100000);
      if(delta===0) throw fail(400,'Stock adjustment must not be zero.');
      const reason=text(input.reason,'Reason',250);
      db.exec('BEGIN IMMEDIATE');
      try{
        const product=db.prepare('SELECT stock FROM products WHERE id=?').get(productId);
        if(!product) throw fail(404,'Product not found.');
        let current=product.stock;
        if(variantId){const variant=db.prepare('SELECT stock FROM product_variants WHERE id=? AND product_id=?').get(variantId,productId);if(!variant) throw fail(404,'Variant not found.');current=variant.stock;}
        if(current+delta<0 || current+delta>100000) throw fail(409,'Adjustment would put stock outside the allowed range.');
        if(variantId){db.prepare('UPDATE product_variants SET stock=?,version=version+1 WHERE id=?').run(current+delta,variantId);db.prepare('UPDATE products SET version=version+1 WHERE id=?').run(productId);}
        else db.prepare('UPDATE products SET stock=?,version=version+1 WHERE id=?').run(current+delta,productId);
        db.prepare('INSERT INTO stock_adjustments(product_id,variant_id,delta,reason,actor) VALUES(?,?,?,?,?)').run(productId,variantId,delta,reason,user.username);
        db.exec('COMMIT');
        return json(res,200,{stock:current+delta});
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    if (pathname === '/api/admin/staff' && req.method === 'GET') {
      requireAdmin(user);
      return json(res, 200, db.prepare('SELECT id, username, role, active, created_at FROM staff_users ORDER BY username').all());
    }
    if (pathname === '/api/admin/staff' && req.method === 'POST') {
      requireAdmin(user);
      const input = await body(req);
      const name = username(input.username);
      if (!['admin', 'staff'].includes(input.role)) throw fail(400, 'Invalid staff role.');
      const password = newPassword(input.password);
      if (db.prepare('SELECT id FROM staff_users WHERE username=? COLLATE NOCASE').get(name)) throw fail(409, 'That username is already in use.');
      const result = db.prepare('INSERT INTO staff_users (username, password_hash, password_salt, role) VALUES (?, ?, ?, ?)').run(name, password.hash, password.salt, input.role);
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    }
    const staffMatch = pathname.match(/^\/api\/admin\/staff\/(\d+)$/);
    if (staffMatch && req.method === 'PATCH') {
      requireAdmin(user);
      const input = await body(req);
      const target = db.prepare('SELECT id, role, active FROM staff_users WHERE id=?').get(Number(staffMatch[1]));
      if (!target) throw fail(404, 'Staff member not found.');
      if (target.id === user.id) throw fail(400, 'Use Change password for your own account.');
      if (Object.keys(input).length !== 1 || (!Object.hasOwn(input, 'active') && !Object.hasOwn(input, 'password'))) throw fail(400, 'Provide one staff update.');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (Object.hasOwn(input, 'active')) {
          if (typeof input.active !== 'boolean') throw fail(400, 'Invalid account status.');
          if (!input.active && target.role === 'admin' && target.active && db.prepare("SELECT COUNT(*) AS count FROM staff_users WHERE role='admin' AND active=1").get().count <= 1) throw fail(409, 'At least one administrator must remain active.');
          db.prepare('UPDATE staff_users SET active=? WHERE id=?').run(input.active ? 1 : 0, target.id);
        } else {
          const password = newPassword(input.password);
          db.prepare('UPDATE staff_users SET password_hash=?, password_salt=? WHERE id=?').run(password.hash, password.salt, target.id);
        }
        db.prepare('DELETE FROM staff_sessions WHERE user_id=?').run(target.id);
        db.exec('COMMIT');
        return json(res, 200, { ok: true });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (pathname === '/api/admin/backups' && req.method === 'GET') {
      requireAdmin(user);
      return json(res, 200, backups.status());
    }
    if (pathname === '/api/admin/backups' && req.method === 'POST') {
      requireAdmin(user);
      return json(res, 201, { filename: await backups.create('manual') });
    }
    if (pathname === '/api/admin/overview' && req.method === 'GET') {
      const orders = db.prepare(`SELECT
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status IN ('confirmed','preparing','out for delivery') THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status='delivered' THEN total ELSE 0 END) AS delivered_subtotal,
        SUM(CASE WHEN date(created_at)=date('now') THEN 1 ELSE 0 END) AS today_orders
        FROM orders`).get();
      const low = db.prepare('SELECT COUNT(*) AS count FROM products WHERE stock<=5').get().count;
      const recent = db.prepare('SELECT id, customer_name, status, total, created_at FROM orders ORDER BY id DESC LIMIT 5').all();
      const catalogProducts = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
      const activity = db.prepare(`WITH RECURSIVE days(day) AS (
        SELECT date('now', '-6 days')
        UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < date('now')
      ) SELECT days.day, COUNT(orders.id) AS count FROM days
        LEFT JOIN orders ON date(orders.created_at)=days.day GROUP BY days.day ORDER BY days.day`).all();
      const topProducts = db.prepare(`SELECT p.id, p.name, p.image, SUM(i.quantity) AS quantity
        FROM order_items i JOIN orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id
        WHERE o.status != 'cancelled'
        GROUP BY p.id, p.name, p.image ORDER BY quantity DESC, p.id LIMIT 4`).all();
      const lowStockItems = db.prepare('SELECT id, name, category, stock, image FROM products WHERE stock<=5 ORDER BY stock, name COLLATE NOCASE LIMIT 4').all();
      return json(res, 200, {
        pending: orders.pending || 0, in_progress: orders.in_progress || 0,
        delivered: orders.delivered || 0, delivered_subtotal: orders.delivered_subtotal || 0,
        today_orders: orders.today_orders || 0, catalog_products: catalogProducts, low_stock: low,
        recent, activity, top_products: topProducts, low_stock_items: lowStockItems
      });
    }
    if (pathname === '/api/admin/order-search' && req.method === 'GET') {
      const { limit, offset } = paging(url);
      const term = searchTerm(url);
      const status = url.searchParams.get('status') || '';
      if (status && !['pending', 'confirmed', 'preparing', 'out for delivery', 'delivered', 'cancelled', 'in_progress'].includes(status)) throw fail(400, 'Invalid order status.');
      const where = "WHERE (CAST(id AS TEXT) LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') AND (?='' OR status=? OR (?='in_progress' AND status IN ('confirmed','preparing','out for delivery')))";
      const params = [term, term, term, status, status, status];
      const total = db.prepare(`SELECT COUNT(*) AS count FROM orders ${where}`).get(...params).count;
      const items = db.prepare(`SELECT id, customer_name, phone, status, payment_status, total, created_at FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
      return json(res, 200, { items, total, limit, offset });
    }
    if (pathname === '/api/admin/product-search' && req.method === 'GET') {
      const { limit, offset } = paging(url);
      const term = searchTerm(url);
      const category = url.searchParams.get('category') || '';
      const stock = url.searchParams.get('stock') || '';
      if (category.length > 80 || !['', 'low', 'out', 'available'].includes(stock)) throw fail(400, 'Invalid product filter.');
      const where = "WHERE (name LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\') AND (?='' OR category=?) AND (?='' OR (?='low' AND stock<=5) OR (?='out' AND stock=0) OR (?='available' AND stock>0))";
      const params = [term, term, category, category, stock, stock, stock, stock];
      const total = db.prepare(`SELECT COUNT(*) AS count FROM products ${where}`).get(...params).count;
      const items = db.prepare(`SELECT * FROM products ${where} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(...params, limit, offset);
      const categories = db.prepare('SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE').all().map(row => row.category);
      return json(res, 200, { items, total, categories, limit, offset });
    }
    if (pathname === '/api/admin/low-variants' && req.method === 'GET') {
      const { limit, offset } = paging(url);
      const total = db.prepare('SELECT COUNT(*) AS count FROM product_variants WHERE stock<=5').get().count;
      const items = db.prepare(`SELECT v.id, v.name, v.stock, p.name AS product_name
        FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.stock<=5
        ORDER BY v.stock, p.name COLLATE NOCASE, v.name COLLATE NOCASE, v.id LIMIT ? OFFSET ?`).all(limit, offset);
      return json(res, 200, { items, total, limit, offset });
    }
    const detailMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (req.method === 'GET' && detailMatch) {
      const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(detailMatch[1]));
      if (!order) throw fail(404, 'Order not found.');
      const items = db.prepare('SELECT id, product_id, variant_id, name, unit_price, quantity FROM order_items WHERE order_id=?').all(order.id);
      const history = db.prepare('SELECT status, actor, created_at FROM order_history WHERE order_id=? ORDER BY id DESC').all(order.id);
      const shipment = db.prepare('SELECT carrier, tracking_number, updated_by, updated_at, version FROM order_shipments WHERE order_id=?').get(order.id) || null;
      const paymentHistory = db.prepare('SELECT status, actor, created_at FROM payment_history WHERE order_id=? ORDER BY id DESC').all(order.id);
      const hasProof = Boolean(db.prepare('SELECT 1 FROM payment_proofs WHERE order_id=?').get(order.id));
      return json(res, 200, { ...order, items, history, shipment, payment_history: paymentHistory, has_payment_proof: hasProof });
    }
    const proofMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/payment-proof$/);
    if (proofMatch && req.method === 'GET') {
      const proof = db.prepare('SELECT file_type, content FROM payment_proofs WHERE order_id=?').get(Number(proofMatch[1]));
      if (!proof) throw fail(404, 'Payment slip not found.');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="payment-slip-${Number(proofMatch[1])}.${proof.file_type}"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox"
      });
      return res.end(proof.content);
    }
    const paymentMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/payment$/);
    if (paymentMatch && req.method === 'PATCH') {
      const input = await body(req);
      if (!['verified', 'rejected'].includes(input.status)) throw fail(400, 'Invalid payment status.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const orderId = Number(paymentMatch[1]);
        const order = db.prepare('SELECT status, payment_status FROM orders WHERE id=?').get(orderId);
        if (!order) throw fail(404, 'Order not found.');
        if (order.payment_status === 'legacy') throw fail(409, 'This order predates bank-transfer verification.');
        if (order.status !== 'pending') throw fail(409, 'Payment can only be changed while an order is pending.');
        if (!db.prepare('SELECT 1 FROM payment_proofs WHERE order_id=?').get(orderId)) throw fail(409, 'No payment slip is available for this order.');
        if (order.payment_status !== input.status) {
          db.prepare('UPDATE orders SET payment_status=? WHERE id=?').run(input.status, orderId);
          db.prepare('INSERT INTO payment_history (order_id, status, actor) VALUES (?, ?, ?)').run(orderId, input.status, user.username);
        }
        db.exec('COMMIT');
        return json(res, 200, { ok: true });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const shipmentMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/shipment$/);
    if (shipmentMatch && req.method === 'PUT') {
      const input = await body(req);
      const carrier = optionalText(input.carrier, 'Carrier', 120);
      const trackingNumber = optionalText(input.tracking_number, 'Tracking number', 120);
      const version = input.version === null ? null : integer(input.version, 'shipment version', 0, Number.MAX_SAFE_INTEGER);
      const orderId = Number(shipmentMatch[1]);
      if (!db.prepare('SELECT id FROM orders WHERE id=?').get(orderId)) throw fail(404, 'Order not found.');
      const existing = db.prepare('SELECT version FROM order_shipments WHERE order_id=?').get(orderId);
      if ((!existing && version !== null) || (existing && version !== existing.version)) throw fail(409, 'Shipment details changed. Reopen the order and try again.');
      if (existing) db.prepare("UPDATE order_shipments SET carrier=?, tracking_number=?, updated_by=?, updated_at=datetime('now'), version=version+1 WHERE order_id=?").run(carrier, trackingNumber, user.username, orderId);
      else db.prepare('INSERT INTO order_shipments (order_id, carrier, tracking_number, updated_by) VALUES (?, ?, ?, ?)').run(orderId, carrier, trackingNumber, user.username);
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
    const variantsMatch = pathname.match(/^\/api\/admin\/products\/(\d+)\/variants$/);
    if (variantsMatch && req.method === 'GET') {
      const productId = Number(variantsMatch[1]);
      if (!db.prepare('SELECT id FROM products WHERE id=?').get(productId)) throw fail(404, 'Product not found.');
      return json(res, 200, db.prepare('SELECT id, product_id, name, price, stock, version FROM product_variants WHERE product_id=? ORDER BY name COLLATE NOCASE, id').all(productId));
    }
    if (variantsMatch && req.method === 'POST') {
      const values = variantInput(await body(req));
      const productId = Number(variantsMatch[1]);
      if (!db.prepare('SELECT id FROM products WHERE id=?').get(productId)) throw fail(404, 'Product not found.');
      if (db.prepare('SELECT id FROM product_variants WHERE product_id=? AND name=? COLLATE NOCASE').get(productId, values[0])) throw fail(409, 'A variant with that name already exists.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare('INSERT INTO product_variants (product_id, name, price, stock) VALUES (?, ?, ?, ?)').run(productId, ...values);
        db.prepare('UPDATE products SET version=version+1 WHERE id=?').run(productId);
        db.exec('COMMIT');
        return json(res, 201, { id: Number(result.lastInsertRowid) });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const variantMatch = pathname.match(/^\/api\/admin\/products\/(\d+)\/variants\/(\d+)$/);
    if (variantMatch && req.method === 'PUT') {
      const input = await body(req);
      const values = variantInput(input);
      const version = integer(input.version, 'variant version', 0, Number.MAX_SAFE_INTEGER);
      const productId = Number(variantMatch[1]);
      const variantId = Number(variantMatch[2]);
      if (db.prepare('SELECT id FROM product_variants WHERE product_id=? AND name=? COLLATE NOCASE AND id!=?').get(productId, values[0], variantId)) throw fail(409, 'A variant with that name already exists.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare('UPDATE product_variants SET name=?, price=?, stock=?, version=version+1 WHERE id=? AND product_id=? AND version=?').run(...values, variantId, productId, version);
        if (!result.changes) {
          if (!db.prepare('SELECT id FROM product_variants WHERE id=? AND product_id=?').get(variantId, productId)) throw fail(404, 'Variant not found.');
          throw fail(409, 'This variant changed. Refresh it before saving.');
        }
        db.prepare('UPDATE products SET version=version+1 WHERE id=?').run(productId);
        db.exec('COMMIT');
        return json(res, 200, { ok: true });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
    if (req.method === 'PUT' && productMatch) {
      const input = await body(req);
      const values = productInput(input);
      const version = integer(input.version, 'product version', 0, Number.MAX_SAFE_INTEGER);
      const result = db.prepare('UPDATE products SET name=?, category=?, description=?, unit=?, price=?, original_price=?, stock=?, image=?, featured=?, version=version+1 WHERE id=? AND version=?').run(...values, Number(productMatch[1]), version);
      if (!result.changes) {
        if (!db.prepare('SELECT id FROM products WHERE id=?').get(Number(productMatch[1]))) throw fail(404, 'Product not found.');
        throw fail(409, 'This product changed since you opened it. Close the form, refresh the product list, and try again.');
      }
      return json(res, 200, { ok: true });
    }
    const orderMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (req.method === 'PATCH' && orderMatch) {
      const input = await body(req);
      if (!['pending', 'confirmed', 'preparing', 'out for delivery', 'delivered', 'cancelled'].includes(input.status)) throw fail(400, 'Invalid order status.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const order = db.prepare('SELECT status, payment_status FROM orders WHERE id=?').get(Number(orderMatch[1]));
        if (!order) throw fail(404, 'Order not found.');
        if (order.status === 'cancelled' && input.status !== 'cancelled') throw fail(409, 'Cancelled orders cannot be reopened. Create a new order instead.');
        if (!['pending', 'cancelled'].includes(input.status) && !['verified', 'legacy'].includes(order.payment_status)) throw fail(409, 'Verify the bank transfer before fulfilling this order.');
        if (order.status !== 'cancelled' && input.status === 'cancelled') {
          const items = db.prepare('SELECT product_id, variant_id, quantity FROM order_items WHERE order_id=?').all(Number(orderMatch[1]));
          const restore = db.prepare('UPDATE products SET stock=stock+?, version=version+1 WHERE id=?');
          const restoreVariant = db.prepare('UPDATE product_variants SET stock=stock+?, version=version+1 WHERE id=?');
          const touchProduct = db.prepare('UPDATE products SET version=version+1 WHERE id=?');
          for (const item of items) {
            if (item.variant_id) { restoreVariant.run(item.quantity, item.variant_id); touchProduct.run(item.product_id); }
            else restore.run(item.quantity, item.product_id);
          }
          db.prepare('DELETE FROM coupon_redemptions WHERE order_id=?').run(Number(orderMatch[1]));
        }
        db.prepare('UPDATE orders SET status=? WHERE id=?').run(input.status, Number(orderMatch[1]));
        if (order.status !== input.status) db.prepare('INSERT INTO order_history (order_id, status, actor) VALUES (?, ?, ?)').run(Number(orderMatch[1]), input.status, user.username);
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
  '/admin.css': ['admin.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/admin-workspace.js': ['admin-workspace.js', 'text/javascript; charset=utf-8']
};
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const publicContent = url.pathname.match(/^\/(pages|blog)\/([a-z0-9-]{1,120})$/);
    if (req.method === 'GET' && publicContent) {
      const module = publicContent[1] === 'blog' ? 'blog_posts' : 'pages';
      const record = db.prepare("SELECT title,data FROM workspace_records WHERE module=? AND status='published' AND json_extract(data,'$.slug')=?").get(module,publicContent[2]);
      if (!record) throw fail(404,'Published content not found.');
      const data = JSON.parse(record.data);
      res.writeHead(200, {
        'Content-Type':'text/html; charset=utf-8',
        'X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'strict-origin-when-cross-origin',
        'Content-Security-Policy':"default-src 'self'; img-src 'self' https:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
      });
      return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(record.title)} | Island Basket</title><link rel="stylesheet" href="/styles.css"></head><body><main class="wrap section published-content"><a href="/">← Island Basket</a><h1>${escapeHTML(record.title)}</h1><p>${escapeHTML(data.description||'')}</p><article>${escapeHTML(data.body||'')}</article></main></body></html>`);
    }
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
  if (!db.prepare('SELECT COUNT(*) AS count FROM staff_users').get().count) console.warn('No staff accounts exist. Set ADMIN_PASSWORD and restart to create the initial admin account.');
});
