import { io } from 'socket.io-client';
import { API_URL } from './api.js';

/**
 * Connect to WebSocket with robust reconnection strategy
 * @param {Object} options - Connection options
 * @param {Function} options.onStatus - Status update callback
 * @param {Function} options.onAlert - Alert callback
 * @param {Function} options.onConnectionChange - Connection state callback
 * @returns {Function} Disconnect function
 */
export function connectSocket({ onStatus, onAlert, onConnectionChange }) {
  const socket = io(API_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
    autoConnect: true
  });

  let reconnectAttempts = 0;
  let isConnected = false;

  // Connection established
  socket.on('connect', () => {
    console.log('WebSocket connected:', socket.id);
    isConnected = true;
    reconnectAttempts = 0;
    
    if (onConnectionChange) {
      onConnectionChange({ connected: true, reconnecting: false });
    }
  });

  // Connection lost
  socket.on('disconnect', (reason) => {
    console.log('WebSocket disconnected:', reason);
    isConnected = false;
    
    if (onConnectionChange) {
      onConnectionChange({ connected: false, reconnecting: true, reason });
    }
  });

  // Reconnection attempt
  socket.io.on('reconnect_attempt', (attempt) => {
    reconnectAttempts = attempt;
    console.log(`WebSocket reconnection attempt ${attempt}...`);
    
    if (onConnectionChange) {
      onConnectionChange({ 
        connected: false, 
        reconnecting: true, 
        attempt: reconnectAttempts 
      });
    }
  });

  // Reconnection successful
  socket.io.on('reconnect', (attempt) => {
    console.log(`WebSocket reconnected after ${attempt} attempts`);
    isConnected = true;
    reconnectAttempts = 0;
    
    if (onConnectionChange) {
      onConnectionChange({ connected: true, reconnecting: false });
    }
  });

  // Reconnection failed
  socket.io.on('reconnect_failed', () => {
    console.error('WebSocket reconnection failed');
    
    if (onConnectionChange) {
      onConnectionChange({ 
        connected: false, 
        reconnecting: false, 
        error: 'Reconnection failed' 
      });
    }
  });

  // Reconnection error
  socket.io.on('reconnect_error', (error) => {
    console.error('WebSocket reconnection error:', error.message);
  });

  // Connection error
  socket.on('connect_error', (error) => {
    console.error('WebSocket connection error:', error.message);
    
    if (onConnectionChange) {
      onConnectionChange({ 
        connected: false, 
        reconnecting: socket.active, 
        error: error.message 
      });
    }
  });

  // Message handlers
  socket.on('status_update', (data) => {
    try {
      onStatus(data);
    } catch (error) {
      console.error('Error handling status update:', error);
    }
  });

  socket.on('alert', (data) => {
    try {
      onAlert(data);
    } catch (error) {
      console.error('Error handling alert:', error);
    }
  });

  // Return disconnect function
  return () => {
    console.log('Disconnecting WebSocket...');
    socket.disconnect();
  };
}

/**
 * Get socket connection health
 */
export function getSocketHealth() {
  return {
    transport: socket?.io?.engine?.transport?.name,
    connected: socket?.connected ?? false,
    id: socket?.id
  };
}
