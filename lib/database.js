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
  if (version > 2) throw new Error('The database was created by a newer version of this application.');
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
  if (db.prepare('SELECT COUNT(*) AS count FROM staff_users').get().count === 0 && bootstrapPassword) {
    if (bootstrapPassword.length > 256) throw new Error('ADMIN_PASSWORD must not exceed 256 characters.');
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO staff_users (username, password_hash, password_salt, role) VALUES (?, ?, ?, ?)')
      .run('admin', passwordHash(bootstrapPassword, salt), salt, 'admin');
    console.log('Created the initial admin account from ADMIN_PASSWORD.');
  }
}

module.exports = { migrate, newPassword, passwordHash };
