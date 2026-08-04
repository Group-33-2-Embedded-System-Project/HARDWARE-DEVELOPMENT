import { db } from './db/index.js';

export function logDeviceMessage(topic, payload, receivedAt, parsedOk = true) {
  db.prepare(`
    INSERT INTO device_messages_raw (topic, payload, received_at, parsed_ok)
    VALUES (?, ?, ?, ?)
  `).run(topic, payload, receivedAt, parsedOk ? 1 : 0);
}

export function listDeviceMessages(limit = 50) {
  return db.prepare(`
    SELECT *
    FROM device_messages_raw
    ORDER BY received_at DESC, id DESC
    LIMIT ?
  `).all(limit);
}

export function getDeviceMessageStats() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN parsed_ok = 1 THEN 1 ELSE 0 END) AS parsed_ok,
      MAX(received_at) AS last_received_at
    FROM device_messages_raw
  `).get();

  return {
    total: totals.total || 0,
    parsedOk: totals.parsed_ok || 0,
    parseFailures: (totals.total || 0) - (totals.parsed_ok || 0),
    lastReceivedAt: totals.last_received_at || null,
  };
}
