import { Server } from 'socket.io';
import { config } from './config.js';
import { snapshot } from './state.js';
import logger from './logger.js';

let io;
let connectedClients = new Map();

export function createSocketServer(server) {
  io = new Server(server, {
    cors: { origin: config.frontendOrigins, methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 1e6, // 1MB
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    const clientId = socket.id;
    const clientIp = socket.handshake.address;
    
    logger.info('WebSocket client connected', {
      clientId,
      clientIp,
      transport: socket.conn.transport.name
    });
    
    connectedClients.set(clientId, {
      id: clientId,
      ip: clientIp,
      connectedAt: new Date().toISOString(),
      transport: socket.conn.transport.name
    });

    // Send current status immediately upon connection
    try {
      socket.emit('status_update', snapshot());
    } catch (error) {
      logger.error('Failed to send initial status', error, { clientId });
    }

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info('WebSocket client disconnected', {
        clientId,
        reason
      });
      connectedClients.delete(clientId);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('WebSocket error', error, { clientId });
    });

    // Log transport upgrades
    socket.conn.on('upgrade', (transport) => {
      logger.debug('Client transport upgraded', {
        clientId,
        transport: transport.name
      });
      
      const client = connectedClients.get(clientId);
      if (client) {
        client.transport = transport.name;
      }
    });
  });

  // Handle server-level errors
  io.engine.on('connection_error', (error) => {
    logger.error('Socket.io connection error', error);
  });

  logger.info('Socket.io server initialized');
  return io;
}

/**
 * Emit status update to all connected clients
 */
export function emitStatus() {
  if (!io) {
    logger.warn('Socket.io not initialized, cannot emit status');
    return;
  }

  try {
    const statusData = snapshot();
    io.emit('status_update', statusData);
    logger.debug('Status emitted to clients', {
      clientCount: connectedClients.size
    });
  } catch (error) {
    logger.error('Failed to emit status', error);
  }
}

/**
 * Emit alert to all connected clients
 */
export function emitAlert(payload) {
  if (!io) {
    logger.warn('Socket.io not initialized, cannot emit alert');
    return;
  }

  try {
    io.emit('alert', payload);
    logger.info('Alert emitted to clients', {
      clientCount: connectedClients.size,
      eventId: payload.eventId
    });
  } catch (error) {
    logger.error('Failed to emit alert', error);
  }
}

/**
 * Get connected clients info
 */
export function getConnectedClients() {
  return Array.from(connectedClients.values());
}

/**
 * Get Socket.io server stats
 */
export function getSocketStats() {
  return {
    connected: connectedClients.size,
    clients: Array.from(connectedClients.values())
  };
}

/**
 * Gracefully close all socket connections
 */
export function closeSocketServer() {
  return new Promise((resolve) => {
    if (!io) {
      resolve();
      return;
    }

    logger.info('Closing Socket.io server');
    
    // Notify all clients
    io.emit('server_shutdown', { message: 'Server is shutting down' });
    
    // Close all connections
    io.close(() => {
      logger.info('Socket.io server closed');
      connectedClients.clear();
      resolve();
    });
  });
}
