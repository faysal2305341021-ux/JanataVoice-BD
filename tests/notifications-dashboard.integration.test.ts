import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { signSessionToken } from '../src/server/auth.ts';
import {
  getStore,
  resetStore,
  resetStoreCacheForTests,
} from '../src/server/store.ts';
import type { Complaint, DashboardSummary, NotificationRecord } from '../src/types/domain.ts';

process.env.JANATAVOICE_TEST_NO_LISTEN = '1';

const { createApiApp } = await import('../server.ts');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janatavoice-notif-dash-test-'));
const tmpStoreFile = path.join(tmpDir, 'test-store.json');

describe('Responsible Notifications & User Complaint Dashboard Integration Tests', () => {
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

  it('notifies responsible dept_officer and dept_head on CRITICAL complaint and notifies triage_officer on low-confidence complaint', async () => {
    const store = getStore();
    const citizen = store.users.find((u) => u.id === 'usr_citizen_demo')!;
    const wasaOfficer = store.users.find(
      (u) => u.role === 'dept_officer' && u.departmentId === 'dept_wasa'
    )!;
    const wasaHead = store.users.find(
      (u) => u.role === 'dept_head' && u.departmentId === 'dept_wasa'
    )!;
    const triageOfficer = store.users.find((u) => u.role === 'triage_officer')!;

    const app = createApiApp();
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const citizenToken = signSessionToken({ uid: citizen.id, email: citizen.email, role: citizen.role });
      const wasaOfficerToken = signSessionToken({
        uid: wasaOfficer.id,
        email: wasaOfficer.email,
        role: wasaOfficer.role,
      });
      const wasaHeadToken = signSessionToken({
        uid: wasaHead.id,
        email: wasaHead.email,
        role: wasaHead.role,
      });
      const triageToken = signSessionToken({
        uid: triageOfficer.id,
        email: triageOfficer.email,
        role: triageOfficer.role,
      });

      // 1. Submit high-confidence CRITICAL WASA complaint
      const createRes = await fetch(`${baseUrl}/api/complaints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${citizenToken}`,
        },
        body: JSON.stringify({
          rawText: 'Water pipe burst flooding main road and drinking water contaminated.',
          classification: {
            category_code: 'WASA_CONTAMINATED_WATER',
            category_id: 'cat_water_dirty',
            department_id: 'dept_wasa',
            confidence: 0.94,
            priority: 'CRITICAL',
            sla_tier: 'CRITICAL',
            reason_code: 'KEYWORD_MATCH',
            detected_language: 'en',
            raw_reasoning: 'Matched WASA contaminated water keywords',
            model_version: 'keyword-fallback-v1',
            raw_model_response: '{}',
          },
        }),
      });
      assert.equal(createRes.status, 201);
      const createBody = (await createRes.json()) as { complaint: Complaint };
      assert.equal(createBody.complaint.responsibleUserId, wasaOfficer.id);
      assert.equal(createBody.complaint.responsibleUserName, wasaOfficer.name);

      // Verify responsible dept_officer got IN_APP + EMAIL_MOCK notifications
      const officerNotifRes = await fetch(`${baseUrl}/api/notifications`, {
        headers: { Authorization: `Bearer ${wasaOfficerToken}` },
      });
      const officerNotifBody = (await officerNotifRes.json()) as {
        notifications: NotificationRecord[];
      };
      const forNewCmp = officerNotifBody.notifications.filter(
        (n) => n.complaintId === createBody.complaint.id
      );
      assert.ok(forNewCmp.some((n) => n.channel === 'IN_APP'));
      assert.ok(forNewCmp.some((n) => n.channel === 'EMAIL_MOCK'));

      // Verify dept_head got CRITICAL notification
      const headNotifRes = await fetch(`${baseUrl}/api/notifications`, {
        headers: { Authorization: `Bearer ${wasaHeadToken}` },
      });
      const headNotifBody = (await headNotifRes.json()) as {
        notifications: NotificationRecord[];
      };
      assert.ok(
        headNotifBody.notifications.some(
          (n) => n.complaintId === createBody.complaint.id && n.message.includes('CRITICAL')
        )
      );

      // 2. Submit low-confidence complaint -> routed to TRIAGING and notifies triage_officer
      const triageCreateRes = await fetch(`${baseUrl}/api/complaints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${citizenToken}`,
        },
        body: JSON.stringify({
          rawText: 'The corner outside our building has been awful since Tuesday.',
          classification: {
            category_code: 'LGD_ROAD_DAMAGE',
            category_id: 'cat_road_pothole',
            department_id: 'dept_lgd',
            confidence: 0.42,
            priority: 'MEDIUM',
            sla_tier: 'STANDARD',
            reason_code: 'LOW_CONFIDENCE',
            detected_language: 'en',
            raw_reasoning: 'Ambiguous description',
            model_version: 'keyword-fallback-v1',
            raw_model_response: '{}',
          },
        }),
      });
      assert.equal(triageCreateRes.status, 201);
      const triageCreateBody = (await triageCreateRes.json()) as { complaint: Complaint };
      assert.equal(triageCreateBody.complaint.status, 'TRIAGING');
      assert.equal(triageCreateBody.complaint.responsibleUserRole, 'triage_officer');

      const triageNotifRes = await fetch(`${baseUrl}/api/notifications`, {
        headers: { Authorization: `Bearer ${triageToken}` },
      });
      const triageNotifBody = (await triageNotifRes.json()) as {
        notifications: NotificationRecord[];
      };
      assert.ok(
        triageNotifBody.notifications.some(
          (n) =>
            n.complaintId === triageCreateBody.complaint.id &&
            n.message.includes('Human Triage')
        )
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('serves role-scoped dashboard summary, assigns field worker with notification, and supports citizen confirm/reopen', async () => {
    const store = getStore();
    const citizen = store.users.find((u) => u.id === 'usr_citizen_demo')!;
    const lgdOfficer = store.users.find((u) => u.id === 'usr_officer_lgd_demo')!;
    const lgdWorker = store.users.find((u) => u.id === 'usr_worker_lgd_demo')!;

    const app = createApiApp();
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      const citizenToken = signSessionToken({ uid: citizen.id, email: citizen.email, role: citizen.role });
      const officerToken = signSessionToken({
        uid: lgdOfficer.id,
        email: lgdOfficer.email,
        role: lgdOfficer.role,
      });
      const workerToken = signSessionToken({
        uid: lgdWorker.id,
        email: lgdWorker.email,
        role: lgdWorker.role,
      });

      // Create LGD complaint
      const createRes = await fetch(`${baseUrl}/api/complaints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${citizenToken}`,
        },
        body: JSON.stringify({
          rawText: 'Deep pothole and broken road near Mirpur 10 intersection.',
          classification: {
            category_code: 'LGD_ROAD_DAMAGE',
            category_id: 'cat_road_pothole',
            department_id: 'dept_lgd',
            confidence: 0.91,
            priority: 'HIGH',
            sla_tier: 'STANDARD',
            reason_code: 'KEYWORD_MATCH',
            detected_language: 'en',
            raw_reasoning: 'Matched road damage keywords',
            model_version: 'keyword-fallback-v1',
            raw_model_response: '{}',
          },
        }),
      });
      assert.equal(createRes.status, 201);
      const { complaint: created } = (await createRes.json()) as { complaint: Complaint };

      // Citizen dashboard is scoped strictly to citizen's complaints
      const citizenDashRes = await fetch(`${baseUrl}/api/complaints/dashboard`, {
        headers: { Authorization: `Bearer ${citizenToken}` },
      });
      assert.equal(citizenDashRes.status, 200);
      const citizenDash = (await citizenDashRes.json()) as {
        complaints: Complaint[];
        summary: DashboardSummary;
      };
      assert.ok(citizenDash.complaints.every((c) => c.citizenId === citizen.id));
      assert.ok(citizenDash.complaints.some((c) => c.id === created.id && c.responsibleUserId === lgdOfficer.id));
      assert.equal(citizenDash.summary.total, citizenDash.complaints.length);

      // LGD Officer dispatches LGD field worker -> notifies worker and updates responsibleUserId
      const assignRes = await fetch(`${baseUrl}/api/complaints/${created.id}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${officerToken}`,
        },
        body: JSON.stringify({ assigneeId: lgdWorker.id, notes: 'Inspect immediately' }),
      });
      assert.equal(assignRes.status, 200);
      const assignBody = (await assignRes.json()) as { complaint: Complaint };
      assert.equal(assignBody.complaint.status, 'IN_PROGRESS');
      assert.equal(assignBody.complaint.responsibleUserId, lgdWorker.id);

      const workerNotifRes = await fetch(`${baseUrl}/api/notifications`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      });
      const workerNotifBody = (await workerNotifRes.json()) as {
        notifications: NotificationRecord[];
      };
      assert.ok(
        workerNotifBody.notifications.some(
          (n) => n.complaintId === created.id && n.message.includes('Inspect immediately')
        )
      );

      // Worker marks RESOLVED -> Citizen confirms CLOSED
      const resolveRes = await fetch(`${baseUrl}/api/complaints/${created.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ status: 'RESOLVED', notes: 'Asphalt patched' }),
      });
      assert.equal(resolveRes.status, 200);

      const closeRes = await fetch(`${baseUrl}/api/complaints/${created.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${citizenToken}`,
        },
        body: JSON.stringify({ status: 'CLOSED' }),
      });
      assert.equal(closeRes.status, 200);
      const closeBody = (await closeRes.json()) as { complaint: Complaint };
      assert.equal(closeBody.complaint.status, 'CLOSED');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
