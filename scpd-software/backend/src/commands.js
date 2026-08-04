import crypto from 'node:crypto';
import { db } from './db/index.js';
import { config } from './config.js';
import logger from './logger.js';

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hydrateCommand(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJson(row.payload_json),
    device_response_json: parseJson(row.device_response_json),
  };
}

export function createCommandRecord(type, payload, requestedBy) {
  const correlationId = crypto.randomUUID();
  const requestedAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO commands (
      type,
      payload_json,
      requested_by,
      requested_at,
      correlation_id
    ) VALUES (?, ?, ?, ?, ?)
  `).run(type, JSON.stringify(payload), requestedBy, requestedAt, correlationId);

  const command = getCommandById(result.lastInsertRowid);
  logger.info('Command record created', {
    commandId: command.id,
    type,
    requestedBy,
    correlationId,
  });
  return command;
}

export function markCommandPublished(commandId) {
  const publishedAt = new Date().toISOString();
  db.prepare(`
    UPDATE commands
    SET publish_status = 'published', published_at = ?
    WHERE id = ?
  `).run(publishedAt, commandId);
  return getCommandById(commandId);
}

export function markCommandFailed(commandId, failureReason) {
  db.prepare(`
    UPDATE commands
    SET publish_status = 'failed',
        ack_status = CASE WHEN ack_status = 'pending' THEN 'failed' ELSE ack_status END,
        failure_reason = ?
    WHERE id = ?
  `).run(failureReason, commandId);
  return getCommandById(commandId);
}

export function markCommandTimedOut(commandId, failureReason = 'Timed out waiting for device acknowledgement.') {
  db.prepare(`
    UPDATE commands
    SET ack_status = 'timed_out',
        failure_reason = COALESCE(failure_reason, ?)
    WHERE id = ? AND ack_status = 'pending'
  `).run(failureReason, commandId);
  return getCommandById(commandId);
}

export function expirePendingCommands() {
  const cutoff = new Date(Date.now() - config.commandAckTimeoutMs).toISOString();
  db.prepare(`
    UPDATE commands
    SET ack_status = 'timed_out',
        failure_reason = COALESCE(failure_reason, 'Timed out waiting for device acknowledgement.')
    WHERE ack_status = 'pending'
      AND publish_status = 'published'
      AND published_at IS NOT NULL
      AND published_at < ?
  `).run(cutoff);
}

export function acknowledgeCommand(correlationId, topic, payload) {
  const command = db.prepare('SELECT * FROM commands WHERE correlation_id = ?').get(correlationId);
  if (!command) return null;

  const response = typeof payload === 'string' ? parseJson(payload) || { raw: payload } : payload;
  const success = response?.success !== false;
  const receivedAt = response?.reportedAt || new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE commands
      SET ack_status = ?,
          acked_at = ?,
          device_response_json = ?,
          failure_reason = CASE WHEN ? THEN failure_reason ELSE COALESCE(?, failure_reason) END
      WHERE id = ?
    `).run(success ? 'acknowledged' : 'failed', receivedAt, JSON.stringify(response), success ? 1 : 0, response?.reason || null, command.id);

    db.prepare(`
      INSERT INTO command_acknowledgements (command_id, topic, payload_json, success, received_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(command.id, topic, JSON.stringify(response), success ? 1 : 0, receivedAt);
  });

  transaction();
  const updated = getCommandById(command.id);
  logger.info('Command acknowledgement processed', {
    commandId: updated.id,
    correlationId,
    success,
  });
  return updated;
}

export function getCommandById(id) {
  expirePendingCommands();
  return hydrateCommand(db.prepare('SELECT * FROM commands WHERE id = ?').get(id));
}

export function listCommands(limit = 20) {
  expirePendingCommands();
  return db.prepare('SELECT * FROM commands ORDER BY requested_at DESC, id DESC LIMIT ?').all(limit).map(hydrateCommand);
}

export function deleteCommand(id) {
  const cmd = db.prepare('SELECT id FROM commands WHERE id = ?').get(id);
  if (!cmd) return false;
  db.prepare('DELETE FROM commands WHERE id = ?').run(id);
  logger.info('Command deleted', { commandId: id });
  return true;
}

export function deleteAllCommands() {
  const res = db.prepare('DELETE FROM commands').run();
  logger.info('All commands deleted', { changes: res.changes });
  return res.changes || 0;
}

export function getLatestCommandSummary() {
  expirePendingCommands();
  const latest = hydrateCommand(
    db.prepare(`
      SELECT *
      FROM commands
      ORDER BY requested_at DESC, id DESC
      LIMIT 1
    `).get()
  );

  const pendingCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM commands
    WHERE publish_status = 'pending' OR ack_status = 'pending'
  `).get().count;

  return {
    latest,
    pendingCount,
  };
}
