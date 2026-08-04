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
const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  // Existing databases may not have newly indexed columns yet; add indexes after column upgrades below.
  .replace(/^CREATE INDEX IF NOT EXISTS idx_events_backend_received_at .*$/gm, '')
  .replace(/^CREATE INDEX IF NOT EXISTS idx_events_severity .*$/gm, '')
  .replace(/^CREATE INDEX IF NOT EXISTS idx_events_source .*$/gm, '');
db.exec(schemaSql);

function hasColumn(table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((entry) => entry.name === column);
}

function ensureColumn(table, column, definition) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureIndex(name, sql) {
  db.exec(sql);
  logger.debug('Database index ensured', { name });
}

ensureColumn('events', 'source', "TEXT NOT NULL DEFAULT 'system'");
ensureColumn('events', 'severity', "TEXT NOT NULL DEFAULT 'info'");
ensureColumn('events', 'backend_received_at', 'DATETIME');
ensureColumn('events', 'device_reported_at', 'DATETIME');
ensureColumn('events', 'correlation_id', 'TEXT');

// Ensure system_state has radar and threat_level for the new sensor and threat model
ensureColumn('system_state', 'radar', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('system_state', 'threat_level', 'INTEGER NOT NULL DEFAULT 0');

ensureIndex(
  'idx_events_backend_received_at',
  'CREATE INDEX IF NOT EXISTS idx_events_backend_received_at ON events(backend_received_at DESC, id DESC)'
);
ensureIndex(
  'idx_events_severity',
  'CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity, backend_received_at DESC)'
);
ensureIndex(
  'idx_events_source',
  'CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, backend_received_at DESC)'
);
db.exec(`
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload_json TEXT,
    requested_by TEXT NOT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    publish_status TEXT NOT NULL DEFAULT 'pending',
    published_at DATETIME,
    ack_status TEXT NOT NULL DEFAULT 'pending',
    acked_at DATETIME,
    device_response_json TEXT,
    failure_reason TEXT,
    correlation_id TEXT NOT NULL UNIQUE
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS command_acknowledgements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id INTEGER REFERENCES commands(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    payload_json TEXT,
    success INTEGER NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS device_messages_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    parsed_ok INTEGER NOT NULL DEFAULT 1
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
ensureIndex(
  'idx_commands_requested_at',
  'CREATE INDEX IF NOT EXISTS idx_commands_requested_at ON commands(requested_at DESC, id DESC)'
);
ensureIndex(
  'idx_commands_publish_status',
  'CREATE INDEX IF NOT EXISTS idx_commands_publish_status ON commands(publish_status, requested_at DESC)'
);
ensureIndex(
  'idx_commands_ack_status',
  'CREATE INDEX IF NOT EXISTS idx_commands_ack_status ON commands(ack_status, requested_at DESC)'
);
ensureIndex(
  'idx_device_messages_received_at',
  'CREATE INDEX IF NOT EXISTS idx_device_messages_received_at ON device_messages_raw(received_at DESC, id DESC)'
);

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

export function createEvent(type, detail = null, metadata = {}) {
  const now = new Date().toISOString();
  const source = metadata.source || 'system';
  const severity = metadata.severity || 'info';
  const backendReceivedAt = metadata.backendReceivedAt || now;
  const deviceReportedAt = metadata.deviceReportedAt || null;
  const correlationId = metadata.correlationId || null;

  const result = db.prepare(`
    INSERT INTO events (
      type,
      detail,
      source,
      severity,
      backend_received_at,
      device_reported_at,
      correlation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    type,
    detail ? JSON.stringify(detail) : null,
    source,
    severity,
    backendReceivedAt,
    deviceReportedAt,
    correlationId
  );

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  
  logger.debug('Event created', {
    type,
    eventId: event.id,
    source,
    severity,
    hasDetail: detail !== null
  });
  
  return {
    ...event,
    detail: event.detail ? JSON.parse(event.detail) : null,
  };
}

export function listEvents(limit) {
  return db.prepare(`
    SELECT *
    FROM events
    ORDER BY COALESCE(backend_received_at, created_at) DESC, id DESC
    LIMIT ?
  `).all(limit).map((event) => ({
    ...event,
    detail: event.detail ? JSON.parse(event.detail) : null,
  }));
}

export function deleteEvent(id) {
  return db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

export function clearEvents() {
  return db.prepare('DELETE FROM events').run();
}
