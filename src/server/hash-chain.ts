import crypto from 'node:crypto';
import type { ComplaintEvent, ComplaintStatus, UserRole } from '../types/domain.ts';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function computeEventHash(prevHash: string, payloadJson: string, timestamp: string): string {
  return crypto
    .createHash('sha256')
    .update(`${prevHash}|${payloadJson}|${timestamp}`)
    .digest('hex');
}

export function buildComplaintEvent(params: {
  id: string;
  complaintId: string;
  actorId: string;
  actorName?: string;
  actorRole?: UserRole | 'system';
  eventType: string;
  fromStatus?: ComplaintStatus | '';
  toStatus?: ComplaintStatus | '';
  payload: Record<string, unknown>;
  prevHash: string;
  createdAt: string;
}): ComplaintEvent {
  const payloadJson = JSON.stringify(params.payload);
  const hash = computeEventHash(params.prevHash, payloadJson, params.createdAt);
  return {
    id: params.id,
    complaintId: params.complaintId,
    actorId: params.actorId,
    actorName: params.actorName || 'System',
    actorRole: params.actorRole || 'system',
    eventType: params.eventType,
    fromStatus: params.fromStatus ?? '',
    toStatus: params.toStatus ?? '',
    payloadJson,
    prevHash: params.prevHash,
    hash,
    createdAt: params.createdAt,
  };
}
