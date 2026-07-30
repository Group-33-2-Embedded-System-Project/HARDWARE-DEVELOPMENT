import webpush from 'web-push';
import { db } from './db/index.js';
import { config } from './config.js';

const enabled = Boolean(config.vapid.subject && config.vapid.publicKey && config.vapid.privateKey);
if (enabled) webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);

export const pushPublicKey = enabled ? config.vapid.publicKey : null;

export async function sendAlertPush(event) {
  if (!enabled) return;
  const payload = JSON.stringify({ title: 'Predator alert', body: 'Motion was detected while the coop was armed.', event });
  const subscriptions = db.prepare('SELECT id, subscription_json FROM push_subscriptions').all();
  await Promise.all(subscriptions.map(async ({ id, subscription_json }) => {
    try {
      await webpush.sendNotification(JSON.parse(subscription_json), payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
      } else console.error('Push delivery failed:', error.message);
    }
  }));
}
