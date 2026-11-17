import type express from 'express';
import type { ComplaintStatus, NotificationRecord, UserRole } from '../types/domain.ts';

interface RealtimeClient {
  id: string;
  userId: string;
  role: UserRole;
  res: express.Response;
}

const clients = new Map<string, RealtimeClient>();

function writeSseEvent(res: express.Response, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Ignore broken pipe; close handler will remove client
  }
}

export function registerRealtimeClient(
  userId: string,
  role: UserRole,
  res: express.Response
): () => void {
  const clientId = `${userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  clients.set(clientId, { id: clientId, userId, role, res });
  writeSseEvent(res, 'connected', { clientId, userId, role, timestamp: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      // ignore
    }
  }, 25000);
  heartbeat.unref?.();

  return () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  };
}

export function broadcastNotification(notification: NotificationRecord): void {
  for (const client of clients.values()) {
    if (client.userId === notification.userId || client.role === 'admin') {
      writeSseEvent(client.res, 'notification', { notification });
    }
  }
}

export function broadcastComplaintUpdate(payload: {
  complaintId: string;
  trackingId: string;
  status: ComplaintStatus;
  responsibleUserId?: string;
  departmentId?: string;
}): void {
  for (const client of clients.values()) {
    writeSseEvent(client.res, 'complaint_update', payload);
  }
}
