import crypto from 'node:crypto';
import type {
  Complaint,
  ComplaintStatus,
  NotificationChannel,
  UserRole,
} from '../types/domain.ts';
import { buildComplaintEvent, GENESIS_HASH } from './hash-chain.ts';
import { broadcastComplaintUpdate, broadcastNotification } from './realtime.ts';
import { getStore, saveStore, type DataStore, type StoredUser } from './store.ts';

export const LEVEL_TO_ROLE: Record<number, UserRole> = {
  1: 'field_worker',
  2: 'dept_officer',
  3: 'dept_head',
  4: 'high_authority',
};

const CLOSED_OR_TERMINAL: ComplaintStatus[] = ['CLOSED'];

export interface SlaSweepOptions {
  now?: Date;
  store?: DataStore;
  persist?: boolean;
  escalationStepGraceHours?: number;
}

export interface SlaSweepResult {
  ranAt: string;
  checkedComplaints: number;
  warningsSent: number;
  escalationsTriggered: number;
  autoClosed: number;
  warningComplaintIds: string[];
  escalatedComplaintIds: string[];
  autoClosedComplaintIds: string[];
  notificationsCreated: number;
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

function getLastEventHash(store: DataStore, complaintId: string): string {
  const events = store.events.filter((e) => e.complaintId === complaintId);
  return events.length > 0 ? events[events.length - 1].hash : GENESIS_HASH;
}

export function findAuthorityForLevel(
  store: DataStore,
  departmentId: string | undefined,
  role: UserRole
): StoredUser | undefined {
  if (role === 'high_authority') {
    return store.users.find((u) => u.role === 'high_authority');
  }
  if (departmentId) {
    const deptMatch = store.users.find(
      (u) => u.role === role && u.departmentId === departmentId
    );
    if (deptMatch) return deptMatch;
  }
  return store.users.find((u) => u.role === role);
}

function pushNotification(
  store: DataStore,
  params: {
    userId: string;
    complaint: Complaint;
    channel: NotificationChannel;
    recipientAddress?: string;
    message: string;
    createdAt: string;
    broadcast?: boolean;
  }
): void {
  const record = {
    id: `notif_${shortId()}`,
    userId: params.userId,
    complaintId: params.complaint.id,
    trackingId: params.complaint.trackingId,
    channel: params.channel,
    recipientAddress: params.recipientAddress,
    message: params.message,
    isRead: false,
    createdAt: params.createdAt,
  };
  store.notifications.unshift(record);
  if (params.broadcast !== false && params.channel === 'IN_APP') {
    broadcastNotification(record);
  }
}

export async function runSlaEscalationSweep(
  options: SlaSweepOptions = {}
): Promise<SlaSweepResult> {
  const store = options.store ?? getStore();
  const persist = options.persist ?? options.store === undefined;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const escalationStepGraceMs = (options.escalationStepGraceHours ?? 12) * 3600 * 1000;

  let warningsSent = 0;
  let escalationsTriggered = 0;
  let autoClosed = 0;
  let notificationsCreated = 0;

  const warningComplaintIds: string[] = [];
  const escalatedComplaintIds: string[] = [];
  const autoClosedComplaintIds: string[] = [];

  for (const complaint of store.complaints) {
    if (CLOSED_OR_TERMINAL.includes(complaint.status)) {
      continue;
    }

    const category = store.categories.find(
      (c) => c.id === complaint.categoryId || c.code === complaint.categoryCode
    );
    const slaCfg = store.slaConfigs.find(
      (s) => s.tier === (category?.slaTier ?? 'STANDARD')
    );

    // 1. Auto-close unconfirmed RESOLVED complaints past citizenConfirmHours
    if (complaint.status === 'RESOLVED' && complaint.resolvedAt) {
      const confirmHours = slaCfg?.citizenConfirmHours ?? 72;
      const resolvedMs = new Date(complaint.resolvedAt).getTime();
      if (nowMs >= resolvedMs + confirmHours * 3600 * 1000) {
        const prevHash = getLastEventHash(store, complaint.id);
        complaint.status = 'CLOSED';
        complaint.closedAt = nowIso;

        store.events.push(
          buildComplaintEvent({
            id: `evt_${shortId()}`,
            complaintId: complaint.id,
            actorId: 'system_sla_engine',
            actorName: 'SLA Escalation Scheduler',
            actorRole: 'system',
            eventType: 'RESOLVED_UNCONFIRMED_AUTO_CLOSE',
            fromStatus: 'RESOLVED',
            toStatus: 'CLOSED',
            payload: { confirmHours, resolvedAt: complaint.resolvedAt },
            prevHash,
            createdAt: nowIso,
          })
        );

        pushNotification(store, {
          userId: complaint.citizenId,
          complaint,
          channel: 'IN_APP',
          message: `Complaint ${complaint.trackingId} was auto-closed as unconfirmed after ${confirmHours}h without citizen response.`,
          createdAt: nowIso,
        });
        notificationsCreated += 1;
        autoClosed += 1;
        autoClosedComplaintIds.push(complaint.id);
      }
      continue;
    }

    const slaDueMs = new Date(complaint.slaDueAt).getTime();
    const createdMs = new Date(complaint.createdAt).getTime();
    if (Number.isNaN(slaDueMs) || Number.isNaN(createdMs)) {
      continue;
    }

    // 2. 100% SLA Breached -> Escalate & Reassign to next authority
    if (nowMs >= slaDueMs) {
      const fromLevel = Math.max(1, Math.min(4, complaint.currentLevel || 1));

      // Do not re-escalate if already escalated at max cabinet level (Level 4)
      if (complaint.status === 'ESCALATED' && fromLevel >= 4) {
        continue;
      }

      // If already in ESCALATED status at L2/L3, respect step grace window before bumping again
      if (complaint.status === 'ESCALATED') {
        const latestEsc = store.escalations
          .filter((e) => e.complaintId === complaint.id)
          .sort((a, b) => b.escalatedAt.localeCompare(a.escalatedAt))[0];
        if (latestEsc) {
          const elapsedSinceLastEsc = nowMs - new Date(latestEsc.escalatedAt).getTime();
          if (elapsedSinceLastEsc < escalationStepGraceMs) {
            continue;
          }
        }
      }

      let toLevel: number;
      if (complaint.status === 'REOPENED' && fromLevel < 2) {
        // Reopened grievances skip Level 1 and move directly to appellate authority
        toLevel = 2;
      } else {
        toLevel = Math.min(4, fromLevel + 1);
      }

      const fromRole = LEVEL_TO_ROLE[fromLevel] || 'field_worker';
      const toRole = LEVEL_TO_ROLE[toLevel] || 'high_authority';
      const nextAssignee = findAuthorityForLevel(store, complaint.departmentId, toRole);
      const prevStatus = complaint.status;

      complaint.currentLevel = toLevel;
      complaint.status = 'ESCALATED';
      if (nextAssignee) {
        complaint.assignedOfficerId = nextAssignee.id;
      }

      const reason = `SLA breached (due ${complaint.slaDueAt}); auto-escalated from Level ${fromLevel} (${fromRole}) to Level ${toLevel} (${toRole}).`;
      store.escalations.unshift({
        id: `esc_${shortId()}`,
        complaintId: complaint.id,
        fromLevel,
        toLevel,
        fromRole,
        toRole,
        reason,
        escalatedAt: nowIso,
      });

      if (nextAssignee) {
        store.assignments.unshift({
          id: `asgn_${shortId()}`,
          complaintId: complaint.id,
          assigneeId: nextAssignee.id,
          assigneeRole: toRole,
          assignedBy: 'system_sla_engine',
          assignedAt: nowIso,
        });
      }

      const prevHash = getLastEventHash(store, complaint.id);
      store.events.push(
        buildComplaintEvent({
          id: `evt_${shortId()}`,
          complaintId: complaint.id,
          actorId: 'system_sla_engine',
          actorName: 'SLA Escalation Scheduler',
          actorRole: 'system',
          eventType: 'SLA_BREACHED_ESCALATED',
          fromStatus: prevStatus,
          toStatus: 'ESCALATED',
          payload: {
            fromLevel,
            toLevel,
            fromRole,
            toRole,
            nextAssigneeId: nextAssignee?.id || null,
            slaDueAt: complaint.slaDueAt,
          },
          prevHash,
          createdAt: nowIso,
        })
      );

      // Notify escalated authority, citizen, and department officer
      const notifiedUserIds = new Set<string>();
      if (nextAssignee) {
        pushNotification(store, {
          userId: nextAssignee.id,
          complaint,
          channel: 'IN_APP',
          recipientAddress: nextAssignee.email,
          message: `SLA BREACH: Complaint ${complaint.trackingId} escalated to Level ${toLevel} (${toRole}) and assigned to you.`,
          createdAt: nowIso,
        });
        pushNotification(store, {
          userId: nextAssignee.id,
          complaint,
          channel: 'EMAIL_MOCK',
          recipientAddress: nextAssignee.email,
          message: `[URGENT SLA ESCALATION] ${complaint.trackingId} breached SLA and requires Level ${toLevel} (${toRole}) intervention.`,
          createdAt: nowIso,
        });
        notificationsCreated += 2;
        notifiedUserIds.add(nextAssignee.id);
      }

      const deptOfficer = findAuthorityForLevel(store, complaint.departmentId, 'dept_officer');
      if (deptOfficer && !notifiedUserIds.has(deptOfficer.id)) {
        pushNotification(store, {
          userId: deptOfficer.id,
          complaint,
          channel: 'IN_APP',
          recipientAddress: deptOfficer.email,
          message: `SLA Breach Alert: ${complaint.trackingId} escalated to Level ${toLevel} (${toRole}).`,
          createdAt: nowIso,
        });
        notificationsCreated += 1;
        notifiedUserIds.add(deptOfficer.id);
      }

      if (complaint.assignedWorkerId && !notifiedUserIds.has(complaint.assignedWorkerId)) {
        pushNotification(store, {
          userId: complaint.assignedWorkerId,
          complaint,
          channel: 'IN_APP',
          message: `Overdue Notice: ${complaint.trackingId} breached SLA and escalated to Level ${toLevel}.`,
          createdAt: nowIso,
        });
        notificationsCreated += 1;
        notifiedUserIds.add(complaint.assignedWorkerId);
      }

      pushNotification(store, {
        userId: complaint.citizenId,
        complaint,
        channel: 'SMS_MOCK',
        recipientAddress: complaint.citizenPhone,
        message: `Update on ${complaint.trackingId}: Your grievance exceeded its SLA deadline and has been auto-escalated to Level ${toLevel} (${toRole}).`,
        createdAt: nowIso,
      });
      pushNotification(store, {
        userId: complaint.citizenId,
        complaint,
        channel: 'IN_APP',
        message: `Your complaint ${complaint.trackingId} breached its SLA window and was escalated to Level ${toLevel} authority.`,
        createdAt: nowIso,
      });
      notificationsCreated += 2;

      escalationsTriggered += 1;
      escalatedComplaintIds.push(complaint.id);
      if (persist) {
        broadcastComplaintUpdate({
          complaintId: complaint.id,
          trackingId: complaint.trackingId,
          status: complaint.status,
          responsibleUserId: nextAssignee?.id || complaint.assignedOfficerId,
          departmentId: complaint.departmentId,
        });
      }
      continue;
    }

    // 3. 80% SLA Warning Reminder (if not yet sent and still within window)
    if (!complaint.reminderSent80) {
      const totalWindowMs = Math.max(1, slaDueMs - createdMs);
      const elapsedPercent = ((nowMs - createdMs) / totalWindowMs) * 100;
      const reminderPercent = slaCfg?.reminderPercent ?? 80;

      if (elapsedPercent >= reminderPercent) {
        complaint.reminderSent80 = true;

        const prevHash = getLastEventHash(store, complaint.id);
        store.events.push(
          buildComplaintEvent({
            id: `evt_${shortId()}`,
            complaintId: complaint.id,
            actorId: 'system_sla_engine',
            actorName: 'SLA Escalation Scheduler',
            actorRole: 'system',
            eventType: 'SLA_WARNING_80',
            fromStatus: complaint.status,
            toStatus: complaint.status,
            payload: {
              elapsedPercent: Math.round(elapsedPercent),
              reminderPercent,
              slaDueAt: complaint.slaDueAt,
            },
            prevHash,
            createdAt: nowIso,
          })
        );

        const recipientIds = new Set<string>();
        if (complaint.assignedWorkerId) recipientIds.add(complaint.assignedWorkerId);
        if (complaint.assignedOfficerId) recipientIds.add(complaint.assignedOfficerId);

        const deptOfficer = findAuthorityForLevel(store, complaint.departmentId, 'dept_officer');
        if (deptOfficer) recipientIds.add(deptOfficer.id);

        for (const uid of recipientIds) {
          const targetUser = store.users.find((u) => u.id === uid);
          pushNotification(store, {
            userId: uid,
            complaint,
            channel: 'IN_APP',
            recipientAddress: targetUser?.email,
            message: `SLA Warning (${Math.round(elapsedPercent)}% elapsed): Complaint ${complaint.trackingId} is due at ${complaint.slaDueAt}.`,
            createdAt: nowIso,
          });
          notificationsCreated += 1;
        }

        warningsSent += 1;
        warningComplaintIds.push(complaint.id);
      }
    }
  }

  if (persist && (warningsSent > 0 || escalationsTriggered > 0 || autoClosed > 0)) {
    await saveStore();
  }

  return {
    ranAt: nowIso,
    checkedComplaints: store.complaints.length,
    warningsSent,
    escalationsTriggered,
    autoClosed,
    warningComplaintIds,
    escalatedComplaintIds,
    autoClosedComplaintIds,
    notificationsCreated,
  };
}

let schedulerTimer: NodeJS.Timeout | null = null;
let lastSweepSummary: SlaSweepResult | null = null;

export function getLastSlaSweepSummary(): SlaSweepResult | null {
  return lastSweepSummary;
}

export function startSlaScheduler(intervalMs = 5 * 60 * 1000): () => void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }
  // Run periodic 5-minute SLA & escalation check
  schedulerTimer = setInterval(() => {
    runSlaEscalationSweep()
      .then((res) => {
        lastSweepSummary = res;
      })
      .catch((err) => {
        console.error('Scheduled SLA sweep failed:', err);
      });
  }, intervalMs);
  schedulerTimer.unref?.();

  return () => {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
  };
}
