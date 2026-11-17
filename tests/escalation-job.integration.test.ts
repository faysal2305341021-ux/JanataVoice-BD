import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';
import { signSessionToken } from '../src/server/auth.ts';
import { buildComplaintEvent, computeEventHash, GENESIS_HASH } from '../src/server/hash-chain.ts';
import { runSlaEscalationSweep } from '../src/server/sla-engine.ts';
import { registerSlaRoutes } from '../src/server/sla-routes.ts';
import {
  getStore,
  resetStore,
  resetStoreCacheForTests,
  saveStore,
} from '../src/server/store.ts';
import type { Complaint } from '../src/types/domain.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janatavoice-sla-test-'));
const tmpStoreFile = path.join(tmpDir, 'test-store.json');

describe('SLA Escalation Job Integration Tests', () => {
  beforeEach(async () => {
    process.env.JANATAVOICE_DATA_FILE = tmpStoreFile;
    resetStoreCacheForTests();
    if (fs.existsSync(tmpStoreFile)) {
      fs.unlinkSync(tmpStoreFile);
    }
    await resetStore();
  });

  after(() => {
    resetStoreCacheForTests();
    delete process.env.JANATAVOICE_DATA_FILE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('simulates a breached SLA, bumps escalation level 1 -> 2, reassigns authority, appends SHA-256 event, and creates notifications', async () => {
    const store = getStore();
    const baseTime = new Date('2026-11-17T10:00:00.000Z');
    const createdAt = new Date(baseTime.getTime() - 28 * 3600 * 1000).toISOString();
    const breachedDueAt = new Date(baseTime.getTime() - 4 * 3600 * 1000).toISOString(); // Breached 4h ago

    const citizen = store.users.find((u) => u.role === 'citizen')!;
    const wasaWorker = store.users.find(
      (u) => u.role === 'field_worker' && u.departmentId === 'dept_wasa'
    )!;
    const wasaOfficer = store.users.find(
      (u) => u.role === 'dept_officer' && u.departmentId === 'dept_wasa'
    )!;

    const testComplaintId = 'cmp_test_breach_01';
    const testComplaint: Complaint = {
      id: testComplaintId,
      trackingId: 'BD-2026-990001',
      citizenId: citizen.id,
      citizenName: citizen.name,
      citizenPhone: citizen.phone,
      division: 'Dhaka',
      district: 'Dhaka',
      rawText: 'পানির পাইপ ফেটে পুরো রাস্তায় জল জমে গেছে।',
      language: 'bn',
      categoryId: 'cat_wasa_leak',
      categoryCode: 'WASA_PIPE_BURST',
      departmentId: 'dept_wasa',
      aiConfidence: 0.92,
      aiReasonCode: 'MATCHED_WASA_PIPE_BURST',
      aiModelVersion: 'gemini-4-hydrogen-v1',
      priority: 'CRITICAL',
      status: 'IN_PROGRESS',
      slaDueAt: breachedDueAt,
      firstResponseDueAt: new Date(baseTime.getTime() - 26 * 3600 * 1000).toISOString(),
      currentLevel: 1,
      assignedWorkerId: wasaWorker.id,
      locationLat: 23.78,
      locationLng: 90.41,
      createdAt,
    };

    const genesisEv = buildComplaintEvent({
      id: 'evt_test_genesis_01',
      complaintId: testComplaintId,
      actorId: citizen.id,
      actorName: citizen.name,
      actorRole: 'citizen',
      eventType: 'COMPLAINT_SUBMITTED',
      fromStatus: '',
      toStatus: 'IN_PROGRESS',
      payload: { trackingId: testComplaint.trackingId },
      prevHash: GENESIS_HASH,
      createdAt,
    });

    store.complaints.unshift(testComplaint);
    store.events.push(genesisEv);
    await saveStore();

    const notifCountBefore = store.notifications.length;
    const escCountBefore = store.escalations.length;

    // Run the SLA escalation job at simulated current time
    const sweepResult = await runSlaEscalationSweep({ now: baseTime });

    assert.ok(
      sweepResult.escalatedComplaintIds.includes(testComplaintId),
      'Breached test complaint must be included in escalatedComplaintIds'
    );
    assert.ok(sweepResult.escalationsTriggered >= 1);
    assert.ok(sweepResult.notificationsCreated >= 4);

    // Reload persisted store from disk cache reset to verify persistence
    resetStoreCacheForTests();
    const persisted = getStore();
    const updated = persisted.complaints.find((c) => c.id === testComplaintId)!;

    assert.equal(updated.currentLevel, 2, 'currentLevel must bump from 1 to 2');
    assert.equal(updated.status, 'ESCALATED', 'status must transition to ESCALATED');
    assert.equal(
      updated.assignedOfficerId,
      wasaOfficer.id,
      'Level 2 escalation must assign owning dept_officer'
    );

    // Assert Escalation record was created
    assert.ok(persisted.escalations.length > escCountBefore);
    const escalationRec = persisted.escalations.find((e) => e.complaintId === testComplaintId);
    assert.ok(escalationRec, 'Escalation record must be created');
    assert.equal(escalationRec.fromLevel, 1);
    assert.equal(escalationRec.toLevel, 2);
    assert.equal(escalationRec.fromRole, 'field_worker');
    assert.equal(escalationRec.toRole, 'dept_officer');

    // Assert Assignment record was created
    const assignmentRec = persisted.assignments.find(
      (a) => a.complaintId === testComplaintId && a.assignedBy === 'system_sla_engine'
    );
    assert.ok(assignmentRec, 'System SLA Assignment record must be created');
    assert.equal(assignmentRec.assigneeId, wasaOfficer.id);
    assert.equal(assignmentRec.assigneeRole, 'dept_officer');

    // Assert SHA-256 ComplaintEvent was appended and properly chained
    const complaintEvents = persisted.events.filter((e) => e.complaintId === testComplaintId);
    assert.equal(complaintEvents.length, 2);
    const escEvent = complaintEvents[1];
    assert.equal(escEvent.eventType, 'SLA_BREACHED_ESCALATED');
    assert.equal(escEvent.fromStatus, 'IN_PROGRESS');
    assert.equal(escEvent.toStatus, 'ESCALATED');
    assert.equal(escEvent.prevHash, genesisEv.hash);
    assert.equal(
      escEvent.hash,
      computeEventHash(escEvent.prevHash, escEvent.payloadJson, escEvent.createdAt),
      'Escalation event hash must match SHA-256 chain'
    );

    // Assert Notifications were created for authority, worker, and citizen
    assert.ok(persisted.notifications.length > notifCountBefore);
    const createdNotifs = persisted.notifications.filter(
      (n) => n.complaintId === testComplaintId
    );
    assert.ok(
      createdNotifs.some(
        (n) => n.userId === wasaOfficer.id && n.channel === 'IN_APP' && n.message.includes('SLA BREACH')
      ),
      'Escalated dept_officer must receive IN_APP SLA BREACH notification'
    );
    assert.ok(
      createdNotifs.some(
        (n) => n.userId === wasaOfficer.id && n.channel === 'EMAIL_MOCK'
      ),
      'Escalated dept_officer must receive EMAIL_MOCK notification'
    );
    assert.ok(
      createdNotifs.some(
        (n) => n.userId === citizen.id && n.channel === 'SMS_MOCK' && n.message.includes('Level 2')
      ),
      'Citizen must receive SMS_MOCK escalation notification'
    );
    assert.ok(
      createdNotifs.some((n) => n.userId === wasaWorker.id && n.channel === 'IN_APP'),
      'Assigned field_worker must receive overdue IN_APP notification'
    );
  });

  it('progresses multi-tier escalation L1 -> L2 -> L3 (dept_head) -> L4 (high_authority) and caps at Level 4', async () => {
    const store = getStore();
    const citizen = store.users.find((u) => u.role === 'citizen')!;
    const lgdHead = store.users.find(
      (u) => u.role === 'dept_head' && u.departmentId === 'dept_lgd'
    )!;
    const highAuthority = store.users.find((u) => u.role === 'high_authority')!;

    const complaintId = 'cmp_test_multitier_02';
    const t0 = new Date('2026-11-17T08:00:00.000Z');
    store.complaints = [
      {
        id: complaintId,
        trackingId: 'BD-2026-990002',
        citizenId: citizen.id,
        citizenName: citizen.name,
        citizenPhone: citizen.phone,
        division: 'Dhaka',
        district: 'Dhaka',
        rawText: 'Severe drainage collapse causing neighborhood flooding.',
        language: 'en',
        categoryId: 'cat_drainage_flood',
        categoryCode: 'LGD_DRAINAGE_BLOCK',
        departmentId: 'dept_lgd',
        aiConfidence: 0.95,
        aiReasonCode: 'MATCHED_LGD_DRAINAGE_BLOCK',
        aiModelVersion: 'gemini-4-hydrogen-v1',
        priority: 'CRITICAL',
        status: 'ASSIGNED',
        slaDueAt: new Date(t0.getTime() - 3600 * 1000).toISOString(),
        firstResponseDueAt: new Date(t0.getTime() - 12 * 3600 * 1000).toISOString(),
        currentLevel: 1,
        locationLat: 23.81,
        locationLng: 90.41,
        createdAt: new Date(t0.getTime() - 48 * 3600 * 1000).toISOString(),
      },
    ];
    await saveStore();

    // Tick 1 (t0): L1 -> L2
    await runSlaEscalationSweep({ now: t0, escalationStepGraceHours: 12 });
    assert.equal(store.complaints[0].currentLevel, 2);

    // Tick 2 (+5 min): still inside 12h grace window, should NOT skip L2 immediately
    const tPlus5m = new Date(t0.getTime() + 5 * 60 * 1000);
    const noopRes = await runSlaEscalationSweep({ now: tPlus5m, escalationStepGraceHours: 12 });
    assert.equal(noopRes.escalationsTriggered, 0);
    assert.equal(store.complaints[0].currentLevel, 2);

    // Tick 3 (+13h): L2 -> L3 (dept_head)
    const tPlus13h = new Date(t0.getTime() + 13 * 3600 * 1000);
    await runSlaEscalationSweep({ now: tPlus13h, escalationStepGraceHours: 12 });
    assert.equal(store.complaints[0].currentLevel, 3);
    assert.equal(store.complaints[0].assignedOfficerId, lgdHead.id);
    assert.ok(
      store.notifications.some(
        (n) => n.userId === lgdHead.id && n.complaintId === complaintId && n.message.includes('Level 3')
      )
    );

    // Tick 4 (+26h): L3 -> L4 (high_authority)
    const tPlus26h = new Date(t0.getTime() + 26 * 3600 * 1000);
    await runSlaEscalationSweep({ now: tPlus26h, escalationStepGraceHours: 12 });
    assert.equal(store.complaints[0].currentLevel, 4);
    assert.equal(store.complaints[0].assignedOfficerId, highAuthority.id);
    assert.ok(
      store.notifications.some(
        (n) =>
          n.userId === highAuthority.id &&
          n.complaintId === complaintId &&
          n.message.includes('Level 4')
      )
    );

    // Tick 5 (+40h): stays capped at Level 4 with no extra escalations
    const tPlus40h = new Date(t0.getTime() + 40 * 3600 * 1000);
    const cappedRes = await runSlaEscalationSweep({ now: tPlus40h, escalationStepGraceHours: 12 });
    assert.equal(cappedRes.escalationsTriggered, 0);
    assert.equal(store.complaints[0].currentLevel, 4);
  });

  it('sends 80% SLA warning notifications once without prematurely escalating', async () => {
    const store = getStore();
    const citizen = store.users.find((u) => u.role === 'citizen')!;
    const powerWorker = store.users.find(
      (u) => u.role === 'field_worker' && u.departmentId === 'dept_power'
    )!;
    const powerOfficer = store.users.find(
      (u) => u.role === 'dept_officer' && u.departmentId === 'dept_power'
    )!;

    const now = new Date('2026-11-17T12:00:00.000Z');
    const createdAt = new Date(now.getTime() - 85 * 3600 * 1000).toISOString(); // 85% elapsed
    const slaDueAt = new Date(now.getTime() + 15 * 3600 * 1000).toISOString();

    const complaintId = 'cmp_test_warn80_03';
    store.complaints = [
      {
        id: complaintId,
        trackingId: 'BD-2026-990003',
        citizenId: citizen.id,
        citizenName: citizen.name,
        citizenPhone: citizen.phone,
        division: 'Dhaka',
        district: 'Gazipur',
        rawText: 'Transformer sparking near feeder line.',
        language: 'en',
        categoryId: 'cat_power_outage',
        categoryCode: 'PWR_OUTAGE_LOADSHED',
        departmentId: 'dept_power',
        aiConfidence: 0.91,
        aiReasonCode: 'MATCHED_PWR_OUTAGE_LOADSHED',
        aiModelVersion: 'gemini-4-hydrogen-v1',
        priority: 'CRITICAL',
        status: 'IN_PROGRESS',
        slaDueAt,
        firstResponseDueAt: new Date(now.getTime() - 80 * 3600 * 1000).toISOString(),
        currentLevel: 1,
        assignedOfficerId: powerOfficer.id,
        assignedWorkerId: powerWorker.id,
        locationLat: 23.99,
        locationLng: 90.42,
        createdAt,
      },
    ];
    await saveStore();

    const firstSweep = await runSlaEscalationSweep({ now });
    assert.equal(firstSweep.warningsSent, 1);
    assert.equal(firstSweep.escalationsTriggered, 0);
    assert.equal(store.complaints[0].reminderSent80, true);
    assert.equal(store.complaints[0].currentLevel, 1);
    assert.equal(store.complaints[0].status, 'IN_PROGRESS');

    const warnNotifs = store.notifications.filter((n) => n.complaintId === complaintId);
    assert.ok(warnNotifs.some((n) => n.userId === powerWorker.id && n.message.includes('85%')));
    assert.ok(warnNotifs.some((n) => n.userId === powerOfficer.id && n.message.includes('85%')));

    // Second sweep 5 minutes later should NOT re-send 80% warning
    const secondSweep = await runSlaEscalationSweep({
      now: new Date(now.getTime() + 5 * 60 * 1000),
    });
    assert.equal(secondSweep.warningsSent, 0);
    assert.equal(
      store.notifications.filter((n) => n.complaintId === complaintId).length,
      warnNotifs.length
    );
  });

  it('auto-closes unconfirmed RESOLVED complaints past citizenConfirmHours and escalates REOPENED complaints', async () => {
    const store = getStore();
    const citizen = store.users.find((u) => u.role === 'citizen')!;
    const now = new Date('2026-11-17T14:00:00.000Z');

    store.complaints = [
      {
        id: 'cmp_test_resolved_stale',
        trackingId: 'BD-2026-990004',
        citizenId: citizen.id,
        citizenName: citizen.name,
        citizenPhone: citizen.phone,
        division: 'Dhaka',
        district: 'Dhaka',
        rawText: 'Streetlight bulb repaired.',
        language: 'en',
        categoryId: 'cat_streetlight',
        categoryCode: 'LGD_STREETLIGHT_OUT',
        departmentId: 'dept_lgd',
        aiConfidence: 0.9,
        aiReasonCode: 'MATCHED_LGD_STREETLIGHT_OUT',
        aiModelVersion: 'gemini-4-hydrogen-v1',
        priority: 'MEDIUM',
        status: 'RESOLVED',
        slaDueAt: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
        firstResponseDueAt: new Date(now.getTime() - 90 * 3600 * 1000).toISOString(),
        currentLevel: 1,
        locationLat: 23.81,
        locationLng: 90.41,
        createdAt: new Date(now.getTime() - 100 * 3600 * 1000).toISOString(),
        resolvedAt: new Date(now.getTime() - 75 * 3600 * 1000).toISOString(), // > 72h STANDARD confirm window
      },
      {
        id: 'cmp_test_reopened_breach',
        trackingId: 'BD-2026-990005',
        citizenId: citizen.id,
        citizenName: citizen.name,
        citizenPhone: citizen.phone,
        division: 'Dhaka',
        district: 'Dhaka',
        rawText: 'Issue reoccurred after closure.',
        language: 'en',
        categoryId: 'cat_streetlight',
        categoryCode: 'LGD_STREETLIGHT_OUT',
        departmentId: 'dept_lgd',
        aiConfidence: 0.9,
        aiReasonCode: 'MATCHED_LGD_STREETLIGHT_OUT',
        aiModelVersion: 'gemini-4-hydrogen-v1',
        priority: 'HIGH',
        status: 'REOPENED',
        slaDueAt: new Date(now.getTime() - 2 * 3600 * 1000).toISOString(),
        firstResponseDueAt: new Date(now.getTime() - 10 * 3600 * 1000).toISOString(),
        currentLevel: 1,
        locationLat: 23.81,
        locationLng: 90.41,
        createdAt: new Date(now.getTime() - 50 * 3600 * 1000).toISOString(),
      },
    ];
    await saveStore();

    const sweep = await runSlaEscalationSweep({ now });
    assert.equal(sweep.autoClosed, 1);
    assert.ok(sweep.autoClosedComplaintIds.includes('cmp_test_resolved_stale'));
    assert.equal(store.complaints[0].status, 'CLOSED');
    assert.ok(store.complaints[0].closedAt);

    assert.equal(sweep.escalationsTriggered, 1);
    assert.equal(store.complaints[1].status, 'ESCALATED');
    assert.equal(store.complaints[1].currentLevel, 2);
  });

  it('executes end-to-end HTTP SLA sweep, updates level & notifications, and supports admin SLA config', async () => {
    const store = getStore();
    const citizen = store.users.find((u) => u.role === 'citizen')!;
    const admin = store.users.find((u) => u.role === 'admin')!;
    const healthOfficer = store.users.find(
      (u) => u.role === 'dept_officer' && u.departmentId === 'dept_health'
    )!;

    // Isolate one breached complaint in HTTP test store
    const targetId = 'cmp_http_breach_06';
    const createdAt = '2026-11-15T00:00:00.000Z';
    const dueAt = '2026-11-16T12:00:00.000Z';
    const simNow = '2026-11-17T06:00:00.000Z';

    store.complaints = [
      {
        id: targetId,
        trackingId: 'BD-2026-990006',
        citizenId: citizen.id,
        citizenName: citizen.name,
        citizenPhone: citizen.phone,
        division: 'Dhaka',
        district: 'Dhaka',
        rawText: 'Hospital emergency ward short on dengue IV fluid.',
        language: 'en',
        categoryId: 'cat_health_emergency',
        categoryCode: 'HLT_EMERGENCY_CARE',
        departmentId: 'dept_health',
        aiConfidence: 0.93,
        aiReasonCode: 'MATCHED_HLT_EMERGENCY_CARE',
        aiModelVersion: 'gemini-4-hydrogen-v1',
        priority: 'CRITICAL',
        status: 'ASSIGNED',
        slaDueAt: dueAt,
        firstResponseDueAt: '2026-11-15T02:00:00.000Z',
        currentLevel: 1,
        locationLat: 23.72,
        locationLng: 90.4,
        createdAt,
      },
    ];
    store.notifications = [];
    store.escalations = [];
    await saveStore();

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    registerSlaRoutes(app);

    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const adminToken = signSessionToken({ uid: admin.id, email: admin.email, role: admin.role });
      const citizenToken = signSessionToken({
        uid: citizen.id,
        email: citizen.email,
        role: citizen.role,
      });
      const officerToken = signSessionToken({
        uid: healthOfficer.id,
        email: healthOfficer.email,
        role: healthOfficer.role,
      });

      // Citizens cannot trigger SLA sweeps (403)
      const forbiddenRes = await fetch(`${baseUrl}/api/sla/run-sweep`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${citizenToken}`,
        },
        body: JSON.stringify({ simulateNowIso: simNow }),
      });
      assert.equal(forbiddenRes.status, 403);

      // Admin triggers SLA sweep simulating breached deadline
      const sweepRes = await fetch(`${baseUrl}/api/sla/run-sweep`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ simulateNowIso: simNow }),
      });
      assert.equal(sweepRes.status, 200);
      const sweepBody = (await sweepRes.json()) as {
        result: { escalationsTriggered: number; escalatedComplaintIds: string[] };
      };
      assert.equal(sweepBody.result.escalationsTriggered, 1);
      assert.deepEqual(sweepBody.result.escalatedComplaintIds, [targetId]);

      // Verify SLA overview reflects escalation and updated complaint level
      const overviewRes = await fetch(`${baseUrl}/api/sla/overview`, {
        headers: { Authorization: `Bearer ${officerToken}` },
      });
      assert.equal(overviewRes.status, 200);
      const overviewBody = (await overviewRes.json()) as {
        stats: { totalEscalations: number };
        breachedComplaints: Complaint[];
      };
      assert.equal(overviewBody.stats.totalEscalations, 1);
      assert.equal(overviewBody.breachedComplaints[0].currentLevel, 2);

      // Verify officer and citizen notifications endpoints return the newly created notifications
      const officerNotifRes = await fetch(`${baseUrl}/api/notifications`, {
        headers: { Authorization: `Bearer ${officerToken}` },
      });
      const officerNotifBody = (await officerNotifRes.json()) as {
        notifications: Array<{ id: string; message: string; isRead: boolean }>;
        unreadCount: number;
      };
      assert.equal(officerNotifRes.status, 200);
      assert.ok(officerNotifBody.unreadCount >= 2);
      assert.ok(officerNotifBody.notifications.some((n) => n.message.includes('BD-2026-990006')));

      // Mark one notification read
      const readRes = await fetch(
        `${baseUrl}/api/notifications/${officerNotifBody.notifications[0].id}/read`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${officerToken}` },
        }
      );
      assert.equal(readRes.status, 200);

      // Admin updates SLA config (e.g., CRITICAL reminderPercent = 75)
      const cfgRes = await fetch(`${baseUrl}/api/admin/sla-configs`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ tier: 'CRITICAL', reminderPercent: 75 }),
      });
      assert.equal(cfgRes.status, 200);
      const cfgBody = (await cfgRes.json()) as { slaConfig: { reminderPercent: number } };
      assert.equal(cfgBody.slaConfig.reminderPercent, 75);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
