CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  severity TEXT NOT NULL DEFAULT 'info',
  backend_received_at DATETIME,
  device_reported_at DATETIME,
  correlation_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  subscription_json TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS command_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id INTEGER REFERENCES commands(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  payload_json TEXT,
  success INTEGER NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_messages_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  parsed_ok INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- State management tables for persistent storage
CREATE TABLE IF NOT EXISTS system_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pir INTEGER NOT NULL DEFAULT 0,
  light INTEGER NOT NULL DEFAULT 0,
  armed INTEGER NOT NULL DEFAULT 0,
  online INTEGER NOT NULL DEFAULT 0,
  radar INTEGER NOT NULL DEFAULT 0,
  threat_level INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS state_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_backend_received_at ON events(backend_received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity, backend_received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, backend_received_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_requested_at ON commands(requested_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_commands_publish_status ON commands(publish_status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_ack_status ON commands(ack_status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_messages_received_at ON device_messages_raw(received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_state_history_changed_at ON state_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_history_field ON state_history(field, changed_at DESC);

-- Initialize system_state if it doesn't exist
-- Keep this minimal so existing databases without newer columns won't fail on import
INSERT OR IGNORE INTO system_state (id) VALUES (1);
