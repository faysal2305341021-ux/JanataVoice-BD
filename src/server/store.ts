import fs from 'node:fs';
import path from 'node:path';
import type {
  AiCorrection,
  Assignment,
  Complaint,
  ComplaintCategory,
  ComplaintEvent,
  Department,
  Escalation,
  Feedback,
  FieldReport,
  NotificationRecord,
  SlaConfig,
  UserProfile,
} from '../types/domain.ts';
import { CATEGORIES, DEPARTMENTS, generateSeedBundle } from './seed-data.ts';

export interface StoredUser extends UserProfile {
  passwordHash?: string;
}

export interface DataStore {
  departments: Department[];
  slaConfigs: SlaConfig[];
  categories: ComplaintCategory[];
  users: StoredUser[];
  complaints: Complaint[];
  events: ComplaintEvent[];
  assignments: Assignment[];
  fieldReports: FieldReport[];
  escalations: Escalation[];
  notifications: NotificationRecord[];
  feedbacks: Feedback[];
  aiCorrections: AiCorrection[];
}

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), '.data');

function getDataFilePath(): string {
  if (process.env.JANATAVOICE_DATA_FILE) {
    return path.resolve(process.env.JANATAVOICE_DATA_FILE);
  }
  return path.join(DEFAULT_DATA_DIR, 'janatavoice-store.json');
}

let memoryStore: DataStore | null = null;
let loadedPath: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export function resetStoreCacheForTests(): void {
  memoryStore = null;
  loadedPath = null;
  writeQueue = Promise.resolve();
}

function buildFreshStore(): DataStore {
  const bundle = generateSeedBundle();
  return {
    departments: bundle.departments,
    slaConfigs: bundle.slaConfigs,
    categories: bundle.categories,
    users: bundle.users,
    complaints: bundle.complaints,
    events: bundle.events,
    assignments: bundle.assignments,
    fieldReports: bundle.fieldReports,
    escalations: bundle.escalations,
    notifications: bundle.notifications,
    feedbacks: bundle.feedbacks,
    aiCorrections: [],
  };
}

export function getStore(): DataStore {
  const dataFile = getDataFilePath();
  const dataDir = path.dirname(dataFile);
  if (memoryStore && loadedPath === dataFile) return memoryStore;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (fs.existsSync(dataFile)) {
    try {
      const raw = fs.readFileSync(dataFile, 'utf8');
      memoryStore = JSON.parse(raw) as DataStore;
      loadedPath = dataFile;
      let backfilled = false;
      for (let idx = 0; idx < memoryStore.complaints.length; idx++) {
        const c = memoryStore.complaints[idx];
        if (!c.aiRawResponse) {
          const guessCat = memoryStore.categories[idx % memoryStore.categories.length];
          const runnerCat = memoryStore.categories[(idx + 2) % memoryStore.categories.length];
          c.aiRawResponse = JSON.stringify({
            engine: c.aiModelVersion || 'gemini-4-hydrogen',
            top_candidate: c.categoryCode || guessCat?.code,
            runner_up: runnerCat?.code,
            confidence: c.aiConfidence,
            detected_language: c.language,
            reasoning:
              c.status === 'TRIAGING' || c.aiConfidence < 0.7
                ? `Low-confidence classification (${Math.round(c.aiConfidence * 100)}% < 70% threshold). Overlapping civic signals between ${guessCat?.code} and ${runnerCat?.code}. Held for triage_officer review.`
                : `Matched ${c.categoryCode || guessCat?.code} with ${Math.round(c.aiConfidence * 100)}% confidence.`,
          });
          backfilled = true;
        }
      }
      for (const dept of memoryStore.departments) {
        const seedDept = DEPARTMENTS.find((d) => d.id === dept.id);
        if (seedDept) {
          if (!dept.descriptionBn && seedDept.descriptionBn) {
            dept.descriptionBn = seedDept.descriptionBn;
            backfilled = true;
          }
          if (!dept.nameBn && seedDept.nameBn) {
            dept.nameBn = seedDept.nameBn;
            backfilled = true;
          }
        }
      }
      for (const cat of memoryStore.categories) {
        const seedCat = CATEGORIES.find((c) => c.id === cat.id || c.code === cat.code);
        if (seedCat && !cat.nameBn) {
          cat.nameBn = seedCat.nameBn;
          backfilled = true;
        }
      }
      if (backfilled) {
        fs.writeFileSync(dataFile, JSON.stringify(memoryStore, null, 2), 'utf8');
      }
      return memoryStore;
    } catch (err) {
      console.warn('Corrupt store file, regenerating seed:', err);
    }
  }
  memoryStore = buildFreshStore();
  loadedPath = dataFile;
  fs.writeFileSync(dataFile, JSON.stringify(memoryStore, null, 2), 'utf8');
  return memoryStore;
}

export async function saveStore(): Promise<void> {
  const dataFile = getDataFilePath();
  const dataDir = path.dirname(dataFile);
  const snapshot = JSON.stringify(getStore(), null, 2);
  writeQueue = writeQueue.then(async () => {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const tmpFile = `${dataFile}.tmp`;
    await fs.promises.writeFile(tmpFile, snapshot, 'utf8');
    await fs.promises.rename(tmpFile, dataFile);
  });
  return writeQueue;
}

export async function resetStore(): Promise<DataStore> {
  memoryStore = buildFreshStore();
  loadedPath = getDataFilePath();
  await saveStore();
  return memoryStore;
}

export function getStoreCounts(): Record<string, number> {
  const s = getStore();
  return {
    departments: s.departments.length,
    categories: s.categories.length,
    users: s.users.length,
    complaints: s.complaints.length,
    complaint_events: s.events.length,
    assignments: s.assignments.length,
    field_reports: s.fieldReports.length,
    escalations: s.escalations.length,
    notifications: s.notifications.length,
    ai_corrections: s.aiCorrections.length,
  };
}
