import 'dotenv/config';

const requiredInProduction = ['JWT_SECRET'];
if (process.env.NODE_ENV === 'production') {
  for (const key of requiredInProduction) {
    if (!process.env[key]) throw new Error(`${key} must be configured in production.`);
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  frontendOrigins: (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  databasePath: process.env.DATABASE_PATH || './data/coop.db',
  deviceStateStaleAfterMs: Number(process.env.DEVICE_STATE_STALE_AFTER_MS || 15000),
  commandAckTimeoutMs: Number(process.env.COMMAND_ACK_TIMEOUT_MS || 15000),
  jwtSecret: process.env.JWT_SECRET || 'development-only-secret-change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me',
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  mqttUsername: process.env.MQTT_USERNAME,
  mqttPassword: process.env.MQTT_PASSWORD,
  mqttClientId: process.env.MQTT_CLIENT_ID || `smart_coop_backend_${process.pid}`,
  vapid: {
    subject: process.env.VAPID_SUBJECT,
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  },
};
