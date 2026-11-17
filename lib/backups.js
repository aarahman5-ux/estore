const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { backup, DatabaseSync } = require('node:sqlite');

function createBackupManager(db, directory) {
  let running = null;
  let lastError = null;
  let lastSuccess = null;
  let timer;

  function verify(filename) {
    const check = new DatabaseSync(filename, { readOnly: true });
    try {
      if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
    } finally { check.close(); }
  }

  async function create(kind) {
    if (running) throw Object.assign(new Error('A backup is already running.'), { status: 409 });
    const date = new Date();
    const day = date.toISOString().slice(0, 10);
    const filename = kind === 'daily' ? `daily-${day}.sqlite` : `manual-${date.toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.sqlite`;
    const target = path.join(directory, filename);
    running = (async () => {
      const temporary = path.join(directory, `.backup-${crypto.randomBytes(12).toString('hex')}.tmp`);
      try {
        fs.mkdirSync(directory, { recursive: true });
        if (kind === 'daily' && fs.existsSync(target)) {
          verify(target);
          lastSuccess = fs.statSync(target).mtime.toISOString();
          lastError = null;
          return filename;
        }
        await backup(db, temporary);
        verify(temporary);
        fs.renameSync(temporary, target);
        if (kind === 'daily') {
          const daily = fs.readdirSync(directory).filter(name => /^daily-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort().reverse();
          for (const old of daily.slice(7)) fs.unlinkSync(path.join(directory, old));
        }
        lastSuccess = new Date().toISOString();
        lastError = null;
        return filename;
      } catch (error) {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        lastError = error.message;
        throw error;
      }
    })();
    try { return await running; } finally { running = null; }
  }
  function start() {
    const run = () => create('daily').catch(error => console.error('Automatic backup failed:', error));
    run();
    timer = setInterval(run, 60 * 60 * 1000);
    timer.unref();
  }
  function status() {
    return { last_success: lastSuccess, last_error: lastError, running: Boolean(running) };
  }
  return { create, start, status };
}

module.exports = { createBackupManager };
