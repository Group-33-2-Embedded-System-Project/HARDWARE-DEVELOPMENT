import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import logger from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(process.cwd(), config.databasePath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

logger.info('Database initialized', {
  path: dbPath,
  journalMode: 'WAL'
});

export async function ensureAdminUser() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(config.adminUsername);
  if (existing) return;
  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(config.adminUsername, passwordHash);
  logger.warn('Created initial admin user', {
    username: config.adminUsername,
    warning: 'Change ADMIN_PASSWORD before deployment'
  });
}

export function createEvent(type, detail = null) {
  const result = db.prepare('INSERT INTO events (type, detail) VALUES (?, ?)')
    .run(type, detail ? JSON.stringify(detail) : null);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  
  logger.debug('Event created', {
    type,
    eventId: event.id,
    hasDetail: detail !== null
  });
  
  return event;
}

export function listEvents(limit) {
  return db.prepare('SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT ?').all(limit)
    .map((event) => ({ ...event, detail: event.detail ? JSON.parse(event.detail) : null }));
}

export function deleteEvent(id) {
  return db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

export function clearEvents() {
  return db.prepare('DELETE FROM events').run();
}

