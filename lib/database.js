const crypto = require('node:crypto');

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function newPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw Object.assign(new Error('Passwords must be between 12 and 256 characters.'), { status: 400 });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: passwordHash(password, salt) };
}

function migrate(db, bootstrapPassword) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 9) throw new Error('The database was created by a newer version of this application.');
  if (version < 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE staff_users (
          id INTEGER PRIMARY KEY,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
          active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE staff_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX staff_sessions_user ON staff_sessions(user_id);
        CREATE TABLE order_history (
          id INTEGER PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id),
          status TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX order_history_order ON order_history(order_id);
        INSERT INTO order_history (order_id, status, actor, created_at)
          SELECT id, status, 'Existing order', created_at FROM orders;
        PRAGMA user_version = 1;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (version < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 2;');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (version < 3) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE product_variants (
          id INTEGER PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id),
          name TEXT NOT NULL COLLATE NOCASE,
          price INTEGER NOT NULL CHECK(price >= 0),
          stock INTEGER NOT NULL CHECK(stock >= 0),
          version INTEGER NOT NULL DEFAULT 0,
          UNIQUE(product_id, name)
        );
        ALTER TABLE order_items ADD COLUMN variant_id INTEGER REFERENCES product_variants(id);
        CREATE TABLE order_shipments (
          order_id INTEGER PRIMARY KEY REFERENCES orders(id),
          carrier TEXT NOT NULL DEFAULT '',
          tracking_number TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          version INTEGER NOT NULL DEFAULT 0
        );
        PRAGMA user_version = 3;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (version < 4) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'legacy'
          CHECK(payment_status IN ('legacy', 'awaiting_verification', 'verified', 'rejected'));
        CREATE TABLE bank_settings (
          id INTEGER PRIMARY KEY CHECK(id=1),
          bank_name TEXT NOT NULL,
          account_name TEXT NOT NULL,
          account_number TEXT NOT NULL,
          instructions TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE payment_proofs (
          order_id INTEGER PRIMARY KEY REFERENCES orders(id),
          file_type TEXT NOT NULL,
          content BLOB NOT NULL
        );
        CREATE TABLE payment_history (
          id INTEGER PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id),
          status TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX payment_history_order ON payment_history(order_id);
        PRAGMA user_version = 4;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
    if (version < 5) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(`
          CREATE TABLE stock_adjustments (
            id INTEGER PRIMARY KEY,
            product_id INTEGER NOT NULL REFERENCES products(id),
            variant_id INTEGER REFERENCES product_variants(id),
            delta INTEGER NOT NULL CHECK(delta != 0),
            reason TEXT NOT NULL,
            actor TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX stock_adjustments_product ON stock_adjustments(product_id, id DESC);
          CREATE TABLE returns (
            id INTEGER PRIMARY KEY,
            order_id INTEGER NOT NULL REFERENCES orders(id),
            status TEXT NOT NULL CHECK(status IN ('requested', 'approved', 'rejected', 'received')),
            reason TEXT NOT NULL,
            staff_note TEXT NOT NULL DEFAULT '',
            actor TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX returns_order ON returns(order_id, id DESC);
          CREATE TABLE return_items (
            id INTEGER PRIMARY KEY,
            return_id INTEGER NOT NULL REFERENCES returns(id),
            order_item_id INTEGER NOT NULL REFERENCES order_items(id),
            name TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK(quantity > 0),
            unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
            restocked INTEGER NOT NULL DEFAULT 0 CHECK(restocked IN (0,1))
          );
          CREATE TABLE refunds (
            id INTEGER PRIMARY KEY,
            return_id INTEGER NOT NULL REFERENCES returns(id),
            amount INTEGER NOT NULL CHECK(amount > 0),
            method TEXT NOT NULL,
            reference TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            actor TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX refunds_return ON refunds(return_id);
          CREATE TABLE workspace_records (
            id INTEGER PRIMARY KEY,
            module TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            data TEXT NOT NULL DEFAULT '{}',
            version INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(module, title COLLATE NOCASE)
          );
          CREATE INDEX workspace_records_module ON workspace_records(module, status, title COLLATE NOCASE);
          CREATE TABLE contact_messages (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','open','resolved','spam')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          PRAGMA user_version = 5;
        `);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
      if (version < 6) {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.exec(`
            ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0 CHECK(discount >= 0);
            CREATE TABLE coupon_redemptions (
              id INTEGER PRIMARY KEY,
              coupon_id INTEGER NOT NULL REFERENCES workspace_records(id) ON DELETE RESTRICT,
              order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
              code TEXT NOT NULL,
              discount INTEGER NOT NULL CHECK(discount >= 0),
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX coupon_redemptions_coupon ON coupon_redemptions(coupon_id);
            PRAGMA user_version = 6;
          `);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
        if (version < 7) {
          db.exec('BEGIN IMMEDIATE');
          try {
            db.exec(`
              CREATE TABLE store_settings (
                id INTEGER PRIMARY KEY CHECK(id=1),
                store_name TEXT NOT NULL,
                page_title TEXT NOT NULL,
                tagline TEXT NOT NULL,
                support_email TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                logo_url TEXT NOT NULL DEFAULT '',
                favicon_url TEXT NOT NULL DEFAULT '',
                version INTEGER NOT NULL DEFAULT 0
              );
              INSERT INTO store_settings(id,store_name,page_title,tagline)
                VALUES(1,'Island Basket','Island Basket | A little bit of everything','A little bit of everything.');
              PRAGMA user_version = 7;
            `);
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        }
  if (version < 8) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE product_images (
          id INTEGER PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          image_url TEXT,
          content_type TEXT,
          content BLOB,
          alt TEXT NOT NULL DEFAULT '',
          is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
          sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK(
            (image_url IS NOT NULL AND content_type IS NULL AND content IS NULL) OR
            (image_url IS NULL AND content_type IN ('image/jpeg','image/png','image/webp') AND content IS NOT NULL)
          )
        );
        CREATE INDEX product_images_product ON product_images(product_id, is_primary DESC, sort_order, id);
        INSERT INTO product_images (product_id, image_url, alt, is_primary, sort_order)
          SELECT id, image, name, 1, 0 FROM products;
        PRAGMA user_version = 8;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (version < 9) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE orders ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'standard'
          CHECK(delivery_method IN ('standard','boat'));
        PRAGMA user_version = 9;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM staff_users').get().count === 0 && bootstrapPassword) {
    if (bootstrapPassword.length > 256) throw new Error('ADMIN_PASSWORD must not exceed 256 characters.');
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO staff_users (username, password_hash, password_salt, role) VALUES (?, ?, ?, ?)')
      .run('admin', passwordHash(bootstrapPassword, salt), salt, 'admin');
    console.log('Created the initial admin account from ADMIN_PASSWORD.');
  }
}

module.exports = { migrate, newPassword, passwordHash };
