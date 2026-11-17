import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import type {
  Complaint,
  ComplaintStatus,
  DashboardSummary,
  NotificationRecord,
  UserProfile,
} from './src/types/domain.ts';
import {
  generateEkIdToken,
  isValidBangladeshiNid,
  requireAuth,
  requireRole,
  sanitizeUser,
  signSessionToken,
  verifyPasswordHash,
  type AuthedRequest,
} from './src/server/auth.ts';
import { classifyComplaint } from './src/server/classifier.ts';
import { adminAuth } from './src/server/firebase-admin.ts';
import { buildComplaintEvent, GENESIS_HASH } from './src/server/hash-chain.ts';
import { broadcastComplaintUpdate, broadcastNotification } from './src/server/realtime.ts';
import { hashPassword } from './src/server/seed-data.ts';
import { startSlaScheduler } from './src/server/sla-engine.ts';
import { registerSlaRoutes } from './src/server/sla-routes.ts';
import { getStore, getStoreCounts, resetStore, saveStore, type DataStore } from './src/server/store.ts';

const PORT = 3000;

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());

  // Initialize persistent seed store on boot
  getStore();

  const setSessionCookie = (res: express.Response, token: string) => {
    res.cookie('jv_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  };

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'janatavoice-bd', timestamp: new Date().toISOString() });
  });

  // Catalog & live schema counts
  app.get('/api/catalog', (_req, res) => {
    const store = getStore();
    res.json({
      departments: store.departments,
      categories: store.categories,
      slaConfigs: store.slaConfigs,
      counts: getStoreCounts(),
    });
  });

  // Public list of 7 demo role accounts
  app.get('/api/auth/demo-accounts', (_req, res) => {
    const store = getStore();
    const demoIds = [
      'usr_citizen_demo',
      'usr_triage_demo',
      'usr_worker_lgd_demo',
      'usr_officer_lgd_demo',
      'usr_head_lgd_demo',
      'usr_cabinet_demo',
      'usr_admin_demo',
    ];
    const accounts = demoIds
      .map((id) => store.users.find((u) => u.id === id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        departmentId: u.departmentId || null,
        division: u.division,
        district: u.district,
      }));
    res.json({ accounts });
  });

  // Email + Password Credential Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const store = getStore();
    const raw = store.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!raw || !raw.passwordHash || !verifyPasswordHash(password, raw.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const user = sanitizeUser(raw as unknown as Record<string, unknown>);
    const token = signSessionToken({ uid: user.id, email: user.email, role: user.role });
    setSessionCookie(res, token);
    res.json({ user, token });
  });

  // Unified Citizen Signup + Mock ekID 10-digit NID flow
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email, phone, password, nidMock, division, district } = req.body as {
        name?: string;
        email?: string;
        phone?: string;
        password?: string;
        nidMock?: string;
        division?: string;
        district?: string;
      };

      if (!name || !email || !password || !phone || !division || !district) {
        return res.status(400).json({ error: 'All profile fields are required for unified signup.' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      }
      if (nidMock && !isValidBangladeshiNid(nidMock)) {
        return res.status(400).json({ error: 'NID must be a valid 10-digit number.' });
      }

      const store = getStore();
      const normalizedEmail = email.trim().toLowerCase();
      if (store.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }

      const id = `usr_cit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const cleanNid = nidMock?.trim() || '';
      const ekIdVerified = Boolean(cleanNid && isValidBangladeshiNid(cleanNid));
      const newUser = {
        id,
        name: name.trim(),
        phone: phone.trim(),
        email: normalizedEmail,
        nidMock: cleanNid,
        ekIdToken: ekIdVerified ? generateEkIdToken(cleanNid) : '',
        ekIdVerified,
        role: 'citizen' as const,
        division: division.trim(),
        district: district.trim(),
        createdAt: new Date().toISOString(),
        passwordHash: hashPassword(password),
      };

      store.users.push(newUser);
      await saveStore();

      const user = sanitizeUser(newUser as unknown as Record<string, unknown>);
      const token = signSessionToken({ uid: user.id, email: user.email, role: user.role });
      setSessionCookie(res, token);
      res.status(201).json({ user, token });
    } catch (error) {
      console.error('Registration failed:', error);
      res.status(500).json({ error: 'Could not register account.' });
    }
  });

  // Google Sign-In via Firebase ID token verification
  app.post('/api/auth/firebase-google', async (req, res) => {
    try {
      const { idToken } = req.body as { idToken?: string };
      if (!idToken) {
        return res.status(400).json({ error: 'Firebase ID token required.' });
      }
      const decoded = await adminAuth.verifyIdToken(idToken);
      const store = getStore();
      let found = store.users.find(
        (u) => u.id === decoded.uid || u.email.toLowerCase() === (decoded.email || '').toLowerCase()
      );
      if (!found) {
        found = {
          id: decoded.uid,
          name: decoded.name || decoded.email?.split('@')[0] || 'Citizen User',
          phone: '',
          email: decoded.email || '',
          nidMock: '',
          ekIdToken: '',
          ekIdVerified: false,
          role: decoded.email === 'faysal2305341021@diu.edu.bd' ? 'admin' : 'citizen',
          division: 'Dhaka',
          district: 'Dhaka',
          createdAt: new Date().toISOString(),
        };
        store.users.push(found);
        await saveStore();
      }
      const user = sanitizeUser(found as unknown as Record<string, unknown>);
      const sessionToken = signSessionToken({ uid: user.id, email: user.email, role: user.role });
      setSessionCookie(res, sessionToken);
      res.json({ user, token: sessionToken });
    } catch (error) {
      console.error('Google token verification failed:', error);
      res.status(401).json({ error: 'Invalid Firebase Google token.' });
    }
  });

  // Mock ekID Verification for an already signed-in user
  app.post('/api/auth/ekid-verify', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { nidMock, name, phone, division, district } = req.body as {
        nidMock?: string;
        name?: string;
        phone?: string;
        division?: string;
        district?: string;
      };
      if (!nidMock || !isValidBangladeshiNid(nidMock)) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit NID number.' });
      }
      const store = getStore();
      const target = store.users.find((u) => u.id === req.user!.id);
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }
      const cleanNid = nidMock.trim();
      target.nidMock = cleanNid;
      target.ekIdToken = generateEkIdToken(cleanNid);
      target.ekIdVerified = true;
      if (name?.trim()) target.name = name.trim();
      if (phone?.trim()) target.phone = phone.trim();
      if (division?.trim()) target.division = division.trim();
      if (district?.trim()) target.district = district.trim();
      await saveStore();

      res.json({ user: sanitizeUser(target as unknown as Record<string, unknown>) });
    } catch (error) {
      console.error('ekID verification error:', error);
      res.status(500).json({ error: 'Failed to verify ekID.' });
    }
  });

  // Get current authenticated session
  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  // Update once-only citizen profile attributes
  app.patch('/api/auth/profile', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { name, phone, division, district } = req.body as Partial<UserProfile>;
      const store = getStore();
      const target = store.users.find((u) => u.id === req.user!.id);
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }
      if (name?.trim()) target.name = name.trim();
      if (phone?.trim()) target.phone = phone.trim();
      if (division?.trim()) target.division = division.trim();
      if (district?.trim()) target.district = district.trim();
      await saveStore();
      res.json({ user: sanitizeUser(target as unknown as Record<string, unknown>) });
    } catch (error) {
      console.error('Profile update failed:', error);
      res.status(500).json({ error: 'Failed to update profile.' });
    }
  });

  // Logout
  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('jv_session');
    res.json({ ok: true });
  });

  // Role-gated User & Department Directory (Staff & Admin only)
  app.get(
    '/api/users/directory',
    requireAuth,
    requireRole('triage_officer', 'dept_officer', 'dept_head', 'high_authority', 'admin'),
    (_req, res) => {
      const store = getStore();
      const users = store.users.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        departmentId: u.departmentId || null,
        division: u.division,
        district: u.district,
        ekIdVerified: u.ekIdVerified,
      }));
      res.json({ users });
    }
  );

  // Admin-only reseed endpoint
  app.post('/api/admin/reseed', requireAuth, requireRole('admin'), async (_req, res) => {
    try {
      await resetStore();
      res.json({ seeded: true, counts: getStoreCounts() });
    } catch (error) {
      console.error('Reseed failed:', error);
      res.status(500).json({ error: 'Reseed failed.' });
    }
  });

  // --- STAGE 2: AI CLASSIFICATION, SUBMISSION & HUMAN TRIAGE QUEUE ---

  const getLastEventHash = (complaintId: string) => {
    const store = getStore();
    const list = store.events.filter((e) => e.complaintId === complaintId);
    return list.length ? list[list.length - 1].hash : GENESIS_HASH;
  };

  const resolveResponsibleParty = (store: DataStore, c: Complaint) => {
    let targetUser =
      c.status === 'TRIAGING'
        ? store.users.find((u) => u.role === 'triage_officer')
        : c.assignedWorkerId && (c.status === 'IN_PROGRESS' || c.currentLevel === 1)
          ? store.users.find((u) => u.id === c.assignedWorkerId)
          : c.assignedOfficerId
            ? store.users.find((u) => u.id === c.assignedOfficerId)
            : undefined;

    if (!targetUser && c.departmentId && c.status !== 'TRIAGING') {
      targetUser = store.users.find(
        (u) => u.role === 'dept_officer' && u.departmentId === c.departmentId
      );
    }
    if (!targetUser) {
      targetUser = store.users.find((u) => u.role === (c.status === 'TRIAGING' ? 'triage_officer' : 'admin'));
    }

    return {
      responsibleUserId: targetUser?.id,
      responsibleUserName: targetUser?.name || (c.status === 'TRIAGING' ? 'Triage Team' : 'System Router'),
      responsibleUserRole: targetUser?.role || ('system' as const),
    };
  };

  const enrichComplaint = (store: DataStore, c: Complaint): Complaint => ({
    ...c,
    ...resolveResponsibleParty(store, c),
  });

  const createAndBroadcastNotification = (store: DataStore, notif: NotificationRecord) => {
    store.notifications.unshift(notif);
    if (notif.channel === 'IN_APP') {
      broadcastNotification(notif);
    }
  };

  // Preview AI Classification (Gemini or Offline Bangla/English/Banglish Fallback)
  app.post('/api/complaints/classify', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { rawText, imageBase64, imageMimeType, voiceNoteTranscript } = req.body as {
        rawText?: string;
        imageBase64?: string;
        imageMimeType?: string;
        voiceNoteTranscript?: string;
      };
      if (!rawText || rawText.trim().length < 5) {
        return res.status(400).json({ error: 'Complaint description must be at least 5 characters.' });
      }
      const store = getStore();
      const result = await classifyComplaint({
        rawText: rawText.trim(),
        categories: store.categories,
        imageBase64,
        imageMimeType,
        voiceNoteTranscript,
      });
      res.json({
        classification: result,
        willRequireHumanTriage: result.confidence < 0.7,
      });
    } catch (error) {
      console.error('Classification endpoint error:', error);
      res.status(500).json({ error: 'Classification failed.' });
    }
  });

  // Submit Complaint (with optional citizen pre-submit category override)
  app.post('/api/complaints', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const {
        rawText,
        imageBase64,
        imageMimeType,
        voiceNoteTranscript,
        locationLat,
        locationLng,
        addressText,
        citizenOverrideCategoryCode,
        classification: precomputedClassification,
      } = req.body as {
        rawText?: string;
        imageBase64?: string;
        imageMimeType?: string;
        voiceNoteTranscript?: string;
        locationLat?: number;
        locationLng?: number;
        addressText?: string;
        citizenOverrideCategoryCode?: string;
        classification?: Awaited<ReturnType<typeof classifyComplaint>>;
      };

      if (!rawText || rawText.trim().length < 5) {
        return res.status(400).json({ error: 'Complaint description must be at least 5 characters.' });
      }

      const store = getStore();
      const classification =
        precomputedClassification ||
        (await classifyComplaint({
          rawText: rawText.trim(),
          categories: store.categories,
          imageBase64,
          imageMimeType,
          voiceNoteTranscript,
        }));

      const citizenOverrideCat = citizenOverrideCategoryCode
        ? store.categories.find((c) => c.code === citizenOverrideCategoryCode)
        : undefined;
      const aiMatchedCat = store.categories.find(
        (c) => c.code === classification.category_code || c.id === classification.category_id
      );
      const effectiveCat = citizenOverrideCat || aiMatchedCat;

      const isOverriddenByCitizen = Boolean(
        citizenOverrideCat && citizenOverrideCat.code !== classification.category_code
      );
      const goesToTriage = !isOverriddenByCitizen && classification.confidence < 0.7;

      const now = new Date();
      const createdAt = now.toISOString();
      const nextNum = store.complaints.length + 1;
      const id = `cmp_${String(nextNum).padStart(4, '0')}_${now.getTime().toString(36)}`;
      const trackingId = `BD-2026-${String(nextNum).padStart(6, '0')}`;

      const slaTier = effectiveCat?.slaTier || classification.sla_tier;
      const slaCfg = store.slaConfigs.find((s) => s.tier === slaTier);
      const firstResponseHours = effectiveCat?.firstResponseHours ?? slaCfg?.firstResponseHours ?? 12;
      const resolutionDays = effectiveCat?.resolutionDays ?? slaCfg?.resolutionDays ?? 3;

      const firstResponseDueAt = new Date(now.getTime() + firstResponseHours * 3600 * 1000).toISOString();
      const slaDueAt = new Date(now.getTime() + resolutionDays * 24 * 3600 * 1000).toISOString();

      let status: ComplaintStatus = goesToTriage ? 'TRIAGING' : 'ASSIGNED';
      const assignedOfficer =
        !goesToTriage && effectiveCat
          ? store.users.find((u) => u.role === 'dept_officer' && u.departmentId === effectiveCat.departmentId)
          : undefined;

      if (!goesToTriage && !assignedOfficer) {
        status = 'SUBMITTED';
      }

      const complaint: Complaint = {
        id,
        trackingId,
        citizenId: req.user!.id,
        citizenName: req.user!.name,
        citizenPhone: req.user!.phone || 'N/A',
        division: req.user!.division,
        district: req.user!.district,
        rawText: rawText.trim(),
        language: classification.detected_language,
        categoryId: goesToTriage ? undefined : effectiveCat?.id,
        categoryCode: goesToTriage ? undefined : effectiveCat?.code,
        departmentId: goesToTriage ? undefined : effectiveCat?.departmentId,
        aiConfidence: classification.confidence,
        aiReasonCode: classification.reason_code,
        aiModelVersion: classification.model_version,
        aiRawResponse: classification.raw_model_response,
        priority: classification.priority,
        status,
        slaDueAt,
        firstResponseDueAt,
        currentLevel: 1,
        assignedOfficerId: assignedOfficer?.id,
        locationLat: typeof locationLat === 'number' ? locationLat : 23.8103,
        locationLng: typeof locationLng === 'number' ? locationLng : 90.4125,
        addressText: addressText?.trim() || `${req.user!.district}, ${req.user!.division}`,
        imageUrl: imageBase64 ? imageBase64.slice(0, 120000) : undefined,
        voiceNoteUrl: voiceNoteTranscript?.trim() || undefined,
        createdAt,
      };

      store.complaints.unshift(complaint);

      // Append genesis ComplaintEvent
      let prevHash = GENESIS_HASH;
      const evSubmit = buildComplaintEvent({
        id: `evt_${Date.now().toString(36)}_1`,
        complaintId: id,
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        eventType: goesToTriage ? 'QUEUED_FOR_TRIAGE' : 'COMPLAINT_SUBMITTED',
        fromStatus: '',
        toStatus: goesToTriage ? 'TRIAGING' : 'SUBMITTED',
        payload: {
          trackingId,
          aiConfidence: classification.confidence,
          aiModelVersion: classification.model_version,
          predictedCategory: classification.category_code,
          citizenOverrideCategory: isOverriddenByCitizen ? citizenOverrideCat?.code : null,
        },
        prevHash,
        createdAt,
      });
      store.events.push(evSubmit);
      prevHash = evSubmit.hash;

      if (isOverriddenByCitizen && citizenOverrideCat) {
        store.aiCorrections.unshift({
          id: `corr_${Date.now().toString(36)}`,
          complaintId: id,
          trackingId,
          predictedCategoryCode: classification.category_code,
          correctedCategoryCode: citizenOverrideCat.code,
          actorId: req.user!.id,
          actorName: req.user!.name,
          actorRole: req.user!.role,
          rawText: rawText.trim(),
          confidence: classification.confidence,
          notes: 'Citizen pre-submission category override',
          createdAt,
        });
      }

      if (assignedOfficer && effectiveCat) {
        store.assignments.push({
          id: `asgn_${Date.now().toString(36)}`,
          complaintId: id,
          assigneeId: assignedOfficer.id,
          assigneeRole: 'dept_officer',
          assignedBy: isOverriddenByCitizen ? req.user!.id : 'system_ai_router',
          assignedAt: createdAt,
        });
        const evAssign = buildComplaintEvent({
          id: `evt_${Date.now().toString(36)}_2`,
          complaintId: id,
          actorId: 'system_ai_router',
          actorName: 'AI Routing Engine',
          actorRole: 'system',
          eventType: 'AUTO_ASSIGNED',
          fromStatus: 'SUBMITTED',
          toStatus: 'ASSIGNED',
          payload: {
            departmentId: effectiveCat.departmentId,
            categoryCode: effectiveCat.code,
            assigneeId: assignedOfficer.id,
          },
          prevHash,
          createdAt,
        });
        store.events.push(evAssign);
      }

      // Notify citizen who submitted
      createAndBroadcastNotification(store, {
        id: `notif_${Date.now().toString(36)}_c`,
        userId: req.user!.id,
        complaintId: id,
        trackingId,
        channel: 'IN_APP',
        recipientAddress: req.user!.email,
        message: goesToTriage
          ? `Complaint ${trackingId} received and routed to Human Triage (AI confidence ${Math.round(classification.confidence * 100)}%).`
          : `Complaint ${trackingId} routed to ${effectiveCat?.departmentId.replace('dept_', '').toUpperCase()} (${effectiveCat?.nameEn})${assignedOfficer ? ` · Assigned to ${assignedOfficer.name}` : ''}.`,
        isRead: false,
        createdAt,
      });

      // Notify responsible staff immediately when a new complaint arrives
      if (goesToTriage) {
        const triageOfficers = store.users.filter((u) => u.role === 'triage_officer');
        triageOfficers.forEach((officer, idx) => {
          createAndBroadcastNotification(store, {
            id: `notif_${Date.now().toString(36)}_tr_${idx}`,
            userId: officer.id,
            complaintId: id,
            trackingId,
            channel: 'IN_APP',
            recipientAddress: officer.email,
            message: `New complaint ${trackingId} from ${req.user!.district} requires Human Triage (${Math.round(classification.confidence * 100)}% AI confidence).`,
            isRead: false,
            createdAt,
          });
        });
      } else if (assignedOfficer && effectiveCat) {
        const deptCode = effectiveCat.departmentId.replace('dept_', '').toUpperCase();
        createAndBroadcastNotification(store, {
          id: `notif_${Date.now().toString(36)}_off`,
          userId: assignedOfficer.id,
          complaintId: id,
          trackingId,
          channel: 'IN_APP',
          recipientAddress: assignedOfficer.email,
          message: `New ${complaint.priority} complaint ${trackingId} (${effectiveCat.nameEn}) in ${req.user!.district} assigned to you (${deptCode}).`,
          isRead: false,
          createdAt,
        });
        createAndBroadcastNotification(store, {
          id: `notif_${Date.now().toString(36)}_off_em`,
          userId: assignedOfficer.id,
          complaintId: id,
          trackingId,
          channel: 'EMAIL_MOCK',
          recipientAddress: assignedOfficer.email,
          message: `[New Complaint Assigned] ${trackingId} · ${effectiveCat.nameEn} · Citizen: ${req.user!.name} (${req.user!.district}).`,
          isRead: false,
          createdAt,
        });

        if (complaint.priority === 'CRITICAL') {
          const deptHead = store.users.find(
            (u) => u.role === 'dept_head' && u.departmentId === effectiveCat.departmentId
          );
          if (deptHead && deptHead.id !== assignedOfficer.id) {
            createAndBroadcastNotification(store, {
              id: `notif_${Date.now().toString(36)}_hd`,
              userId: deptHead.id,
              complaintId: id,
              trackingId,
              channel: 'IN_APP',
              recipientAddress: deptHead.email,
              message: `CRITICAL new complaint ${trackingId} (${effectiveCat.nameEn}) assigned to ${assignedOfficer.name}.`,
              isRead: false,
              createdAt,
            });
          }
        }
      } else {
        const fallbackAdmins = store.users.filter((u) => u.role === 'admin');
        fallbackAdmins.forEach((adm, idx) => {
          createAndBroadcastNotification(store, {
            id: `notif_${Date.now().toString(36)}_adm_${idx}`,
            userId: adm.id,
            complaintId: id,
            trackingId,
            channel: 'IN_APP',
            recipientAddress: adm.email,
            message: `New complaint ${trackingId} requires department assignment.`,
            isRead: false,
            createdAt,
          });
        });
      }

      await saveStore();
      const enriched = enrichComplaint(store, complaint);
      broadcastComplaintUpdate({
        complaintId: enriched.id,
        trackingId: enriched.trackingId,
        status: enriched.status,
        responsibleUserId: enriched.responsibleUserId,
        departmentId: enriched.departmentId,
      });

      res.status(201).json({
        complaint: enriched,
        events: store.events.filter((e) => e.complaintId === id),
      });
    } catch (error) {
      console.error('Submit complaint error:', error);
      res.status(500).json({ error: 'Failed to submit complaint.' });
    }
  });

  // Citizen's submitted complaints
  app.get('/api/complaints/my', requireAuth, (req: AuthedRequest, res) => {
    const store = getStore();
    const list = store.complaints
      .filter((c) => c.citizenId === req.user!.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => enrichComplaint(store, c));
    res.json({ complaints: list });
  });

  // Unified Role-Scoped User Complaint Dashboard
  app.get('/api/complaints/dashboard', requireAuth, (req: AuthedRequest, res) => {
    const store = getStore();
    const user = req.user!;
    const nowMs = Date.now();

    let scoped: Complaint[];
    if (user.role === 'citizen') {
      scoped = store.complaints.filter((c) => c.citizenId === user.id);
    } else if (user.role === 'triage_officer') {
      scoped = store.complaints.filter(
        (c) => c.status === 'TRIAGING' || c.aiConfidence < 0.7 || c.assignedOfficerId === user.id
      );
    } else if (user.role === 'field_worker') {
      scoped = store.complaints.filter(
        (c) =>
          c.assignedWorkerId === user.id ||
          (user.departmentId ? c.departmentId === user.departmentId : false)
      );
    } else if (user.role === 'dept_officer') {
      scoped = store.complaints.filter(
        (c) =>
          c.assignedOfficerId === user.id ||
          (user.departmentId ? c.departmentId === user.departmentId : false)
      );
    } else if (user.role === 'dept_head') {
      scoped = store.complaints.filter(
        (c) =>
          (user.departmentId ? c.departmentId === user.departmentId : true) ||
          c.currentLevel >= 3
      );
    } else {
      // high_authority & admin see national portfolio
      scoped = [...store.complaints];
    }

    const enrichedList = scoped
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => enrichComplaint(store, c));

    const statuses: ComplaintStatus[] = [
      'SUBMITTED',
      'TRIAGING',
      'ASSIGNED',
      'IN_PROGRESS',
      'ESCALATED',
      'REOPENED',
      'RESOLVED',
      'CLOSED',
    ];

    let active = 0;
    let atRisk = 0;
    let breached = 0;
    let escalated = 0;
    let resolvedClosed = 0;
    let assignedToMe = 0;

    const statusCounts = new Map<ComplaintStatus, number>();
    for (const s of statuses) statusCounts.set(s, 0);

    const deptMap = new Map<
      string,
      { departmentId: string; code: string; active: number; breached: number; resolved: number }
    >();
    for (const d of store.departments) {
      deptMap.set(d.id, { departmentId: d.id, code: d.code, active: 0, breached: 0, resolved: 0 });
    }

    for (const c of enrichedList) {
      statusCounts.set(c.status, (statusCounts.get(c.status) || 0) + 1);

      const isMyResponsibility =
        c.responsibleUserId === user.id ||
        c.assignedOfficerId === user.id ||
        c.assignedWorkerId === user.id ||
        (user.role === 'triage_officer' && c.status === 'TRIAGING');
      if (isMyResponsibility && c.status !== 'CLOSED' && c.status !== 'RESOLVED') {
        assignedToMe += 1;
      }

      const isTerminal = c.status === 'RESOLVED' || c.status === 'CLOSED';
      const deptEntry = c.departmentId ? deptMap.get(c.departmentId) : undefined;

      if (isTerminal) {
        resolvedClosed += 1;
        if (deptEntry) deptEntry.resolved += 1;
      } else {
        active += 1;
        if (c.status === 'ESCALATED' || c.status === 'REOPENED') {
          escalated += 1;
        }
        const dueMs = new Date(c.slaDueAt).getTime();
        const createdMs = new Date(c.createdAt).getTime();
        const totalMs = Math.max(1, dueMs - createdMs);
        const elapsedPct = ((nowMs - createdMs) / totalMs) * 100;
        if (dueMs <= nowMs) {
          breached += 1;
          if (deptEntry) deptEntry.breached += 1;
        } else {
          if (elapsedPct >= 80) atRisk += 1;
          if (deptEntry) deptEntry.active += 1;
        }
      }
    }

    const summary: DashboardSummary = {
      total: enrichedList.length,
      assignedToMe,
      active,
      atRisk,
      breached,
      escalated,
      resolvedClosed,
      byStatus: statuses.map((s) => ({ status: s, count: statusCounts.get(s) || 0 })),
      byDepartment: Array.from(deptMap.values()),
    };

    const assignableStaff = store.users
      .filter(
        (u) =>
          (u.role === 'field_worker' || u.role === 'dept_officer') &&
          (user.role === 'admin' ||
            user.role === 'high_authority' ||
            !user.departmentId ||
            u.departmentId === user.departmentId)
      )
      .map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        departmentId: u.departmentId || null,
        district: u.district,
      }));

    res.json({
      complaints: enrichedList,
      summary,
      assignableStaff,
    });
  });

  // Assign field worker / officer from dashboard
  app.post(
    '/api/complaints/:id/assign',
    requireAuth,
    requireRole('dept_officer', 'dept_head', 'admin'),
    async (req: AuthedRequest, res) => {
      try {
        const { assigneeId, notes } = req.body as { assigneeId?: string; notes?: string };
        if (!assigneeId) {
          return res.status(400).json({ error: 'Assignee user ID is required.' });
        }
        const store = getStore();
        const complaint = store.complaints.find((c) => c.id === req.params.id);
        if (!complaint) {
          return res.status(404).json({ error: 'Complaint not found.' });
        }
        const assignee = store.users.find((u) => u.id === assigneeId);
        if (!assignee) {
          return res.status(404).json({ error: 'Assignee user not found.' });
        }

        const nowIso = new Date().toISOString();
        const prevStatus = complaint.status;
        if (assignee.role === 'field_worker') {
          complaint.assignedWorkerId = assignee.id;
          if (complaint.status === 'SUBMITTED' || complaint.status === 'ASSIGNED') {
            complaint.status = 'IN_PROGRESS';
          }
        } else {
          complaint.assignedOfficerId = assignee.id;
          if (complaint.status === 'SUBMITTED') {
            complaint.status = 'ASSIGNED';
          }
        }

        store.assignments.unshift({
          id: `asgn_${Date.now().toString(36)}`,
          complaintId: complaint.id,
          assigneeId: assignee.id,
          assigneeRole: assignee.role,
          assignedBy: req.user!.id,
          assignedAt: nowIso,
        });

        const prevHash = getLastEventHash(complaint.id);
        const ev = buildComplaintEvent({
          id: `evt_${Date.now().toString(36)}_as`,
          complaintId: complaint.id,
          actorId: req.user!.id,
          actorName: req.user!.name,
          actorRole: req.user!.role,
          eventType: assignee.role === 'field_worker' ? 'DISPATCHED_TO_FIELD' : 'REASSIGNED_OFFICER',
          fromStatus: prevStatus,
          toStatus: complaint.status,
          payload: {
            assigneeId: assignee.id,
            assigneeRole: assignee.role,
            notes: notes?.trim() || '',
          },
          prevHash,
          createdAt: nowIso,
        });
        store.events.push(ev);

        createAndBroadcastNotification(store, {
          id: `notif_${Date.now().toString(36)}_as_w`,
          userId: assignee.id,
          complaintId: complaint.id,
          trackingId: complaint.trackingId,
          channel: 'IN_APP',
          recipientAddress: assignee.email,
          message: `You have been assigned complaint ${complaint.trackingId} (${complaint.categoryCode || 'Civic Issue'}) in ${complaint.district}.${notes?.trim() ? ` Note: ${notes.trim()}` : ''}`,
          isRead: false,
          createdAt: nowIso,
        });

        createAndBroadcastNotification(store, {
          id: `notif_${Date.now().toString(36)}_as_c`,
          userId: complaint.citizenId,
          complaintId: complaint.id,
          trackingId: complaint.trackingId,
          channel: 'IN_APP',
          message: `Update on ${complaint.trackingId}: Assigned to ${assignee.name} (${assignee.role.replace('_', ' ')}).`,
          isRead: false,
          createdAt: nowIso,
        });

        await saveStore();
        const enriched = enrichComplaint(store, complaint);
        broadcastComplaintUpdate({
          complaintId: enriched.id,
          trackingId: enriched.trackingId,
          status: enriched.status,
          responsibleUserId: enriched.responsibleUserId,
          departmentId: enriched.departmentId,
        });

        res.json({ complaint: enriched, event: ev });
      } catch (error) {
        console.error('Assign complaint error:', error);
        res.status(500).json({ error: 'Failed to assign complaint.' });
      }
    }
  );

  // Update complaint workflow status (Staff progress/resolve OR Citizen confirm/reopen)
  app.patch('/api/complaints/:id/status', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { status: nextStatus, notes } = req.body as {
        status?: ComplaintStatus;
        notes?: string;
      };
      if (!nextStatus) {
        return res.status(400).json({ error: 'Target status is required.' });
      }
      const store = getStore();
      const complaint = store.complaints.find((c) => c.id === req.params.id);
      if (!complaint) {
        return res.status(404).json({ error: 'Complaint not found.' });
      }

      const user = req.user!;
      const nowIso = new Date().toISOString();
      const prevStatus = complaint.status;

      if (user.role === 'citizen') {
        if (complaint.citizenId !== user.id) {
          return res.status(403).json({ error: 'You can only update your own complaints.' });
        }
        if (nextStatus !== 'CLOSED' && nextStatus !== 'REOPENED') {
          return res.status(400).json({ error: 'Citizens can only confirm closure (CLOSED) or reopen (REOPENED).' });
        }
      } else if (!['field_worker', 'dept_officer', 'dept_head', 'high_authority', 'admin'].includes(user.role)) {
        return res.status(403).json({ error: 'Role not authorized to change workflow status.' });
      }

      complaint.status = nextStatus;
      if (nextStatus === 'RESOLVED') {
        complaint.resolvedAt = nowIso;
      } else if (nextStatus === 'CLOSED') {
        complaint.closedAt = nowIso;
        store.feedbacks.unshift({
          id: `fb_${Date.now().toString(36)}`,
          complaintId: complaint.id,
          citizenId: user.id,
          satisfied: true,
          comment: notes?.trim() || 'Citizen confirmed resolution.',
          createdAt: nowIso,
        });
      } else if (nextStatus === 'REOPENED') {
        const fromLevel = complaint.currentLevel || 1;
        const nextLevel = Math.max(2, Math.min(4, fromLevel + 1));
        complaint.currentLevel = nextLevel;
        const appellateRole = nextLevel >= 3 ? 'dept_head' : 'dept_officer';
        const appellate =
          store.users.find(
            (u) => u.role === appellateRole && (!complaint.departmentId || u.departmentId === complaint.departmentId)
          ) || store.users.find((u) => u.role === 'dept_head');
        if (appellate) {
          complaint.assignedOfficerId = appellate.id;
          createAndBroadcastNotification(store, {
            id: `notif_${Date.now().toString(36)}_re_app`,
            userId: appellate.id,
            complaintId: complaint.id,
            trackingId: complaint.trackingId,
            channel: 'IN_APP',
            recipientAddress: appellate.email,
            message: `REOPENED APPEAL: Citizen reopened ${complaint.trackingId}; escalated directly to Level ${nextLevel} (${appellate.name}).`,
            isRead: false,
            createdAt: nowIso,
          });
        }
        store.feedbacks.unshift({
          id: `fb_${Date.now().toString(36)}`,
          complaintId: complaint.id,
          citizenId: user.id,
          satisfied: false,
          comment: notes?.trim() || 'Citizen reopened complaint for appellate review.',
          createdAt: nowIso,
        });
        store.escalations.unshift({
          id: `esc_${Date.now().toString(36)}`,
          complaintId: complaint.id,
          fromLevel,
          toLevel: nextLevel,
          fromRole: 'field_worker',
          toRole: appellateRole,
          reason: notes?.trim() || 'Citizen reopened resolved complaint — skipped Level 1 to appellate authority.',
          escalatedAt: nowIso,
        });
      }

      const prevHash = getLastEventHash(complaint.id);
      const ev = buildComplaintEvent({
        id: `evt_${Date.now().toString(36)}_st`,
        complaintId: complaint.id,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        eventType:
          nextStatus === 'CLOSED'
            ? 'CITIZEN_CONFIRMED_CLOSE'
            : nextStatus === 'REOPENED'
              ? 'CITIZEN_REOPENED'
              : `STATUS_CHANGED_${nextStatus}`,
        fromStatus: prevStatus,
        toStatus: nextStatus,
        payload: { notes: notes?.trim() || '' },
        prevHash,
        createdAt: nowIso,
      });
      store.events.push(ev);

      if (user.role !== 'citizen') {
        createAndBroadcastNotification(store, {
          id: `notif_${Date.now().toString(36)}_st_c`,
          userId: complaint.citizenId,
          complaintId: complaint.id,
          trackingId: complaint.trackingId,
          channel: 'IN_APP',
          message: `Complaint ${complaint.trackingId} status updated to ${nextStatus} by ${user.name}.${notes?.trim() ? ` Note: ${notes.trim()}` : ''}`,
          isRead: false,
          createdAt: nowIso,
        });
      }

      await saveStore();
      const enriched = enrichComplaint(store, complaint);
      broadcastComplaintUpdate({
        complaintId: enriched.id,
        trackingId: enriched.trackingId,
        status: enriched.status,
        responsibleUserId: enriched.responsibleUserId,
        departmentId: enriched.departmentId,
      });

      res.json({ complaint: enriched, event: ev });
    } catch (error) {
      console.error('Update status error:', error);
      res.status(500).json({ error: 'Failed to update complaint status.' });
    }
  });

  // Complaint detail + vertical audit timeline
  app.get('/api/complaints/:id/timeline', requireAuth, (req: AuthedRequest, res) => {
    const store = getStore();
    const complaint = store.complaints.find(
      (c) => c.id === req.params.id || c.trackingId === req.params.id
    );
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    if (req.user!.role === 'citizen' && complaint.citizenId !== req.user!.id) {
      return res.status(403).json({ error: 'You can only view your own complaints.' });
    }
    const events = store.events
      .filter((e) => e.complaintId === complaint.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const corrections = store.aiCorrections.filter((a) => a.complaintId === complaint.id);
    res.json({ complaint: enrichComplaint(store, complaint), events, corrections });
  });

  // Triage Officer Queue (Low-confidence < 0.70 & TRIAGING complaints)
  app.get(
    '/api/triage/queue',
    requireAuth,
    requireRole('triage_officer', 'admin'),
    (_req, res) => {
      const store = getStore();
      const queue = store.complaints
        .filter((c) => c.status === 'TRIAGING' || c.aiConfidence < 0.7)
        .sort((a, b) => {
          // Put pending TRIAGING items first, then lowest confidence first
          if (a.status === 'TRIAGING' && b.status !== 'TRIAGING') return -1;
          if (b.status === 'TRIAGING' && a.status !== 'TRIAGING') return 1;
          return a.aiConfidence - b.aiConfidence;
        });

      res.json({
        queue,
        corrections: store.aiCorrections,
        stats: {
          pendingTriage: queue.filter((q) => q.status === 'TRIAGING').length,
          totalLowConfidence: queue.length,
          loggedOverrides: store.aiCorrections.length,
        },
      });
    }
  );

  // Triage Officer Re-route & Override Log
  app.post(
    '/api/triage/:id/reroute',
    requireAuth,
    requireRole('triage_officer', 'admin'),
    async (req: AuthedRequest, res) => {
      try {
        const { targetCategoryCode, notes } = req.body as {
          targetCategoryCode?: string;
          notes?: string;
        };
        if (!targetCategoryCode) {
          return res.status(400).json({ error: 'Target category is required to re-route.' });
        }
        const store = getStore();
        const complaint = store.complaints.find((c) => c.id === req.params.id);
        if (!complaint) {
          return res.status(404).json({ error: 'Complaint not found.' });
        }
        const targetCat = store.categories.find((c) => c.code === targetCategoryCode);
        if (!targetCat) {
          return res.status(400).json({ error: 'Invalid target category code.' });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const prevStatus = complaint.status;

        // Parse predicted candidate from aiRawResponse if categoryCode wasn't finalized yet
        let predictedCode = complaint.categoryCode || 'UNCLASSIFIED';
        if (complaint.aiRawResponse) {
          try {
            const parsed = JSON.parse(complaint.aiRawResponse) as { top_candidate?: string; category_code?: string };
            predictedCode = parsed.top_candidate || parsed.category_code || predictedCode;
          } catch {
            // keep fallback
          }
        }

        // Update complaint routing & recalculate SLA window
        const slaCfg = store.slaConfigs.find((s) => s.tier === targetCat.slaTier);
        const firstHours = targetCat.firstResponseHours ?? slaCfg?.firstResponseHours ?? 12;
        const resDays = targetCat.resolutionDays ?? slaCfg?.resolutionDays ?? 3;
        const createdMs = new Date(complaint.createdAt).getTime();

        complaint.categoryId = targetCat.id;
        complaint.categoryCode = targetCat.code;
        complaint.departmentId = targetCat.departmentId;
        complaint.priority = targetCat.slaTier === 'CRITICAL' ? 'CRITICAL' : targetCat.slaTier === 'STANDARD' ? 'MEDIUM' : 'HIGH';
        complaint.firstResponseDueAt = new Date(createdMs + firstHours * 3600 * 1000).toISOString();
        complaint.slaDueAt = new Date(createdMs + resDays * 24 * 3600 * 1000).toISOString();
        complaint.status = 'ASSIGNED';

        const deptOfficer = store.users.find(
          (u) => u.role === 'dept_officer' && u.departmentId === targetCat.departmentId
        );
        if (deptOfficer) {
          complaint.assignedOfficerId = deptOfficer.id;
          store.assignments.push({
            id: `asgn_${Date.now().toString(36)}`,
            complaintId: complaint.id,
            assigneeId: deptOfficer.id,
            assigneeRole: 'dept_officer',
            assignedBy: req.user!.id,
            assignedAt: nowIso,
          });
        }

        // Log human override into ground-truth training table
        const correction = {
          id: `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
          complaintId: complaint.id,
          trackingId: complaint.trackingId,
          predictedCategoryCode: predictedCode,
          correctedCategoryCode: targetCat.code,
          actorId: req.user!.id,
          actorName: req.user!.name,
          actorRole: req.user!.role,
          rawText: complaint.rawText,
          confidence: complaint.aiConfidence,
          notes: notes?.trim() || 'Triage officer manual routing override',
          createdAt: nowIso,
        };
        store.aiCorrections.unshift(correction);

        // Append immutable hash-chained event
        const prevHash = getLastEventHash(complaint.id);
        const ev = buildComplaintEvent({
          id: `evt_${Date.now().toString(36)}_tr`,
          complaintId: complaint.id,
          actorId: req.user!.id,
          actorName: req.user!.name,
          actorRole: req.user!.role,
          eventType: 'TRIAGE_REROUTED_AND_LOGGED',
          fromStatus: prevStatus,
          toStatus: 'ASSIGNED',
          payload: {
            predictedCategoryCode: predictedCode,
            correctedCategoryCode: targetCat.code,
            departmentId: targetCat.departmentId,
            assignedOfficerId: deptOfficer?.id || null,
            correctionId: correction.id,
            notes: correction.notes,
          },
          prevHash,
          createdAt: nowIso,
        });
        store.events.push(ev);

        // Notify citizen & assigned department officer in real time
        createAndBroadcastNotification(store, {
          id: `notif_${Date.now().toString(36)}_tr_c`,
          userId: complaint.citizenId,
          complaintId: complaint.id,
          trackingId: complaint.trackingId,
          channel: 'SMS_MOCK',
          recipientAddress: complaint.citizenPhone,
          message: `Triage verified ${complaint.trackingId} and routed to ${targetCat.departmentId.replace('dept_', '').toUpperCase()} (${targetCat.nameEn}).`,
          isRead: false,
          createdAt: nowIso,
        });
        createAndBroadcastNotification(store, {
          id: `notif_${Date.now().toString(36)}_tr_c_app`,
          userId: complaint.citizenId,
          complaintId: complaint.id,
          trackingId: complaint.trackingId,
          channel: 'IN_APP',
          message: `Triage routed ${complaint.trackingId} to ${targetCat.departmentId.replace('dept_', '').toUpperCase()}${deptOfficer ? ` · Officer: ${deptOfficer.name}` : ''}.`,
          isRead: false,
          createdAt: nowIso,
        });
        if (deptOfficer) {
          createAndBroadcastNotification(store, {
            id: `notif_${Date.now().toString(36)}_tr_o`,
            userId: deptOfficer.id,
            complaintId: complaint.id,
            trackingId: complaint.trackingId,
            channel: 'IN_APP',
            recipientAddress: deptOfficer.email,
            message: `Triage officer assigned new complaint ${complaint.trackingId} (${targetCat.nameEn}) to your responsibility.`,
            isRead: false,
            createdAt: nowIso,
          });
        }

        await saveStore();
        const enriched = enrichComplaint(store, complaint);
        broadcastComplaintUpdate({
          complaintId: enriched.id,
          trackingId: enriched.trackingId,
          status: enriched.status,
          responsibleUserId: enriched.responsibleUserId,
          departmentId: enriched.departmentId,
        });
        res.json({ complaint: enriched, correction, event: ev });
      } catch (error) {
        console.error('Triage reroute error:', error);
        res.status(500).json({ error: 'Failed to re-route complaint.' });
      }
    }
  );

  // --- STAGE 3: SLA & ESCALATION ENGINE ROUTES + 5-MIN SCHEDULER ---
  registerSlaRoutes(app);

  return app;
}

async function startServer() {
  const app = createApiApp();

  // Vite dev middleware or production static build
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    startSlaScheduler(5 * 60 * 1000);
    console.log(`JanataVoice BD server listening on http://localhost:${PORT}`);
  });
}

if (process.env.JANATAVOICE_TEST_NO_LISTEN !== '1') {
  startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  });
}
