import type { Express } from 'express';
import { requireAuth, requireRole, type AuthedRequest } from './auth.ts';
import { registerRealtimeClient } from './realtime.ts';
import { getLastSlaSweepSummary, runSlaEscalationSweep } from './sla-engine.ts';
import { getStore, saveStore } from './store.ts';
import type { SlaTier } from '../types/domain.ts';

export function registerSlaRoutes(app: Express): void {
  // Staff overview of SLA risks, recent escalations, and configurable SLA tiers
  app.get(
    '/api/sla/overview',
    requireAuth,
    requireRole('dept_officer', 'dept_head', 'high_authority', 'admin'),
    (_req, res) => {
      const store = getStore();
      const nowMs = Date.now();
      const active = store.complaints.filter(
        (c) => c.status !== 'RESOLVED' && c.status !== 'CLOSED'
      );
      const breached = active.filter((c) => new Date(c.slaDueAt).getTime() <= nowMs);
      const atRisk80 = active.filter((c) => {
        const createdMs = new Date(c.createdAt).getTime();
        const dueMs = new Date(c.slaDueAt).getTime();
        if (dueMs <= nowMs) return false;
        const pct = ((nowMs - createdMs) / Math.max(1, dueMs - createdMs)) * 100;
        return pct >= 80;
      });

      res.json({
        slaConfigs: store.slaConfigs,
        lastSweep: getLastSlaSweepSummary(),
        stats: {
          activeCount: active.length,
          breachedCount: breached.length,
          atRisk80Count: atRisk80.length,
          totalEscalations: store.escalations.length,
        },
        breachedComplaints: breached.slice(0, 30),
        escalations: store.escalations.slice(0, 50),
      });
    }
  );

  // Trigger repeatable SLA escalation sweep on demand (supports simulateNowIso for testing/demo)
  app.post(
    '/api/sla/run-sweep',
    requireAuth,
    requireRole('dept_officer', 'dept_head', 'high_authority', 'admin'),
    async (req: AuthedRequest, res) => {
      try {
        const { simulateNowIso, escalationStepGraceHours } = (req.body || {}) as {
          simulateNowIso?: string;
          escalationStepGraceHours?: number;
        };
        const now = simulateNowIso ? new Date(simulateNowIso) : new Date();
        if (Number.isNaN(now.getTime())) {
          return res.status(400).json({ error: 'Invalid simulateNowIso timestamp.' });
        }
        const result = await runSlaEscalationSweep({
          now,
          escalationStepGraceHours,
        });
        res.json({ result });
      } catch (error) {
        console.error('Manual SLA sweep error:', error);
        res.status(500).json({ error: 'Failed to run SLA escalation sweep.' });
      }
    }
  );

  // Admin-configurable SLA tier numbers
  app.patch(
    '/api/admin/sla-configs',
    requireAuth,
    requireRole('admin'),
    async (req, res) => {
      try {
        const { tier, firstResponseHours, resolutionDays, reminderPercent, citizenConfirmHours } =
          req.body as {
            tier?: SlaTier;
            firstResponseHours?: number;
            resolutionDays?: number;
            reminderPercent?: number;
            citizenConfirmHours?: number;
          };

        if (!tier) {
          return res.status(400).json({ error: 'SLA tier is required.' });
        }
        const store = getStore();
        const target = store.slaConfigs.find((s) => s.tier === tier);
        if (!target) {
          return res.status(404).json({ error: 'SLA tier config not found.' });
        }

        if (typeof firstResponseHours === 'number' && firstResponseHours > 0) {
          target.firstResponseHours = firstResponseHours;
        }
        if (typeof resolutionDays === 'number' && resolutionDays > 0) {
          target.resolutionDays = resolutionDays;
        }
        if (typeof reminderPercent === 'number' && reminderPercent >= 10 && reminderPercent <= 99) {
          target.reminderPercent = reminderPercent;
        }
        if (typeof citizenConfirmHours === 'number' && citizenConfirmHours >= 1) {
          target.citizenConfirmHours = citizenConfirmHours;
        }

        await saveStore();
        res.json({ slaConfig: target, slaConfigs: store.slaConfigs });
      } catch (error) {
        console.error('Update SLA config error:', error);
        res.status(500).json({ error: 'Failed to update SLA configuration.' });
      }
    }
  );

  // Real-time SSE notification stream for logged-in user
  app.get('/api/notifications/stream', requireAuth, (req: AuthedRequest, res) => {
    const unregister = registerRealtimeClient(req.user!.id, req.user!.role, res);
    req.on('close', unregister);
    req.on('error', unregister);
  });

  // Notifications feed (own notifications, or ?all=true outbox for admin)
  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
    const store = getStore();
    const wantAll = req.query.all === 'true' && req.user!.role === 'admin';
    const items = (wantAll
      ? [...store.notifications]
      : store.notifications.filter((n) => n.userId === req.user!.id)
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({
      notifications: items.slice(0, 120),
      unreadCount: items.filter((n) => !n.isRead).length,
    });
  });

  app.patch('/api/notifications/read-all', requireAuth, async (req: AuthedRequest, res) => {
    const store = getStore();
    let updated = 0;
    for (const n of store.notifications) {
      if (n.userId === req.user!.id && !n.isRead) {
        n.isRead = true;
        updated += 1;
      }
    }
    if (updated > 0) {
      await saveStore();
    }
    res.json({ ok: true, updated });
  });

  app.patch('/api/notifications/:id/read', requireAuth, async (req: AuthedRequest, res) => {
    const store = getStore();
    const target = store.notifications.find((n) => n.id === req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    if (target.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot modify another user notification.' });
    }
    target.isRead = true;
    await saveStore();
    res.json({ notification: target });
  });
}
