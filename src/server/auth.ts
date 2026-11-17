import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { UserProfile, UserRole } from '../types/domain.ts';
import { adminAuth } from './firebase-admin.ts';
import { hashPassword } from './seed-data.ts';
import { getStore, saveStore } from './store.ts';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`janatavoice-${process.env.APP_URL || 'local-dev'}`).digest('hex');

export interface SessionPayload {
  uid: string;
  email: string;
  role: UserRole;
  exp: number;
}

export interface AuthedRequest extends Request {
  user?: UserProfile;
}

export function sanitizeUser(raw: Record<string, unknown>): UserProfile {
  const { passwordHash: _ignored, ...rest } = raw;
  return rest as unknown as UserProfile;
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const full: SessionPayload = {
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `jv.${body}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token.startsWith('jv.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function verifyPasswordHash(password: string, storedHash: string): boolean {
  const candidate = hashPassword(password);
  if (candidate.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(storedHash));
}

export function generateEkIdToken(nid: string): string {
  const digest = crypto.createHash('sha256').update(`${nid}:${Date.now()}`).digest('hex').slice(0, 8).toUpperCase();
  return `EKID-BD-2026-${nid.slice(-4)}-${digest}`;
}

export function isValidBangladeshiNid(nid: string): boolean {
  return /^\d{10}$/.test(nid.trim());
}

export async function resolveUserFromRequest(req: Request): Promise<UserProfile | null> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const cookieToken = typeof req.cookies?.jv_session === 'string' ? req.cookies.jv_session : '';
  const token = bearer || cookieToken;

  if (!token) return null;

  const store = getStore();

  // 1. Check signed portal session token
  if (token.startsWith('jv.')) {
    const payload = verifySessionToken(token);
    if (!payload) return null;
    const found = store.users.find((u) => u.id === payload.uid);
    if (!found) return null;
    return sanitizeUser(found as unknown as Record<string, unknown>);
  }

  // 2. Otherwise verify Firebase Auth ID Token
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    let found = store.users.find((u) => u.id === decoded.uid || u.email.toLowerCase() === (decoded.email || '').toLowerCase());
    if (!found) {
      found = {
        id: decoded.uid,
        name: decoded.name || decoded.email?.split('@')[0] || 'Citizen User',
        phone: '',
        email: decoded.email || '',
        nidMock: '',
        ekIdVerified: false,
        role: decoded.email === 'faysal2305341021@diu.edu.bd' ? 'admin' : 'citizen',
        division: 'Dhaka',
        district: 'Dhaka',
        createdAt: new Date().toISOString(),
      };
      store.users.push(found);
      await saveStore();
    }
    return sanitizeUser(found as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}. Current role: ${req.user.role}.`,
      });
    }
    next();
  };
}
