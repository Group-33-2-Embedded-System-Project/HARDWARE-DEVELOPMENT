import { getMqttStatus } from './mqtt/client.js';
import { snapshot } from './state.js';
import { getLatestCommandSummary } from './commands.js';

export function buildStatusView() {
  const device = snapshot();
  const mqtt = getMqttStatus();
  const commands = getLatestCommandSummary();

  return {
    device: {
      pir: device.pir,
      light: device.light,
      armed: device.armed,
      online: device.online,
      radar: device.radar,
      threat_level: device.threat_level,
      reportedAt: device.reportedAt,
      receivedAt: device.receivedAt,
      updatedAt: device.updatedAt,
      freshness: device.freshness,
    },
    backend: {
      mqttConnected: mqtt.connected,
      lastMqttConnectionTime: mqtt.lastConnectionTime
        ? new Date(mqtt.lastConnectionTime).toISOString()
        : null,
      connectionAttempts: mqtt.connectionAttempts,
    },
    commands,
    meta: {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
    },
  };
}
