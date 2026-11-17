export type UserRole =
  | 'citizen'
  | 'triage_officer'
  | 'field_worker'
  | 'dept_officer'
  | 'dept_head'
  | 'high_authority'
  | 'admin';

export type SlaTier = 'CRITICAL' | 'STANDARD' | 'COMPLEX' | 'POLICY';

export type ComplaintPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ComplaintStatus =
  | 'SUBMITTED'
  | 'TRIAGING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'ESCALATED';

export type ComplaintLanguage = 'bn' | 'en' | 'banglish';

export type NotificationChannel = 'IN_APP' | 'EMAIL_MOCK' | 'SMS_MOCK';

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  nidMock: string;
  ekIdToken?: string;
  ekIdVerified: boolean;
  role: UserRole;
  departmentId?: string;
  division: string;
  district: string;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  nameBn: string;
  code: string;
  parentDepartmentId?: string;
  description?: string;
  descriptionBn?: string;
}

export interface ComplaintCategory {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string;
  departmentId: string;
  slaTier: SlaTier;
  firstResponseHours: number;
  resolutionDays: number;
  keywordsEn: string[];
  keywordsBn: string[];
  keywordsBanglish: string[];
}

export interface Complaint {
  id: string;
  trackingId: string;
  citizenId: string;
  citizenName: string;
  citizenPhone: string;
  division: string;
  district: string;
  rawText: string;
  language: ComplaintLanguage;
  categoryId?: string;
  categoryCode?: string;
  departmentId?: string;
  aiConfidence: number;
  aiReasonCode: string;
  aiModelVersion: string;
  aiRawResponse?: string;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  slaDueAt: string;
  firstResponseDueAt: string;
  currentLevel: number;
  assignedOfficerId?: string;
  assignedWorkerId?: string;
  locationLat: number;
  locationLng: number;
  addressText?: string;
  imageUrl?: string;
  voiceNoteUrl?: string;
  reminderSent80?: boolean;
  resolvedAt?: string;
  createdAt: string;
  closedAt?: string;
  responsibleUserId?: string;
  responsibleUserName?: string;
  responsibleUserRole?: UserRole | 'system';
}

export interface DashboardSummary {
  total: number;
  assignedToMe: number;
  active: number;
  atRisk: number;
  breached: number;
  escalated: number;
  resolvedClosed: number;
  byStatus: Array<{ status: ComplaintStatus; count: number }>;
  byDepartment: Array<{ departmentId: string; code: string; active: number; breached: number; resolved: number }>;
}

export interface ComplaintEvent {
  id: string;
  complaintId: string;
  actorId: string;
  actorName?: string;
  actorRole?: UserRole | 'system';
  eventType: string;
  fromStatus?: ComplaintStatus | '';
  toStatus?: ComplaintStatus | '';
  payloadJson: string;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface Assignment {
  id: string;
  complaintId: string;
  assigneeId: string;
  assigneeRole: UserRole;
  assignedBy: string;
  assignedAt: string;
}

export interface FieldReport {
  id: string;
  complaintId: string;
  workerId: string;
  workerName?: string;
  notes: string;
  beforePhotoUrl: string;
  afterPhotoUrl: string;
  geoLat: number;
  geoLng: number;
  submittedAt: string;
}

export interface Escalation {
  id: string;
  complaintId: string;
  fromLevel: number;
  toLevel: number;
  fromRole: UserRole;
  toRole: UserRole;
  reason: string;
  escalatedAt: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  complaintId: string;
  trackingId?: string;
  channel: NotificationChannel;
  recipientAddress?: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface Feedback {
  id: string;
  complaintId: string;
  citizenId: string;
  satisfied: boolean;
  comment: string;
  createdAt: string;
}

export interface AiCorrection {
  id: string;
  complaintId: string;
  trackingId?: string;
  predictedCategoryCode: string;
  correctedCategoryCode: string;
  actorId: string;
  actorName?: string;
  actorRole: UserRole;
  rawText: string;
  confidence: number;
  notes?: string;
  createdAt: string;
}

export interface SlaConfig {
  tier: SlaTier;
  firstResponseHours: number;
  resolutionDays: number;
  reminderPercent: number;
  citizenConfirmHours: number;
}

export const BANGLADESH_DIVISIONS: Record<string, string[]> = {
  Dhaka: ['Dhaka', 'Gazipur', 'Narayanganj', 'Tangail', 'Narsingdi', 'Munshiganj'],
  Chattogram: ['Chattogram', "Cox's Bazar", 'Cumilla', 'Noakhali', 'Feni'],
  Rajshahi: ['Rajshahi', 'Bogura', 'Pabna', 'Naogaon', 'Sirajganj'],
  Khulna: ['Khulna', 'Jashore', 'Satkhira', 'Kushtia', 'Bagerhat'],
  Sylhet: ['Sylhet', 'Moulvibazar', 'Habiganj', 'Sunamganj'],
  Barishal: ['Barishal', 'Patuakhali', 'Bhola', 'Pirojpur'],
  Rangpur: ['Rangpur', 'Dinajpur', 'Kurigram', 'Gaibandha'],
  Mymensingh: ['Mymensingh', 'Jamalpur', 'Netrokona', 'Sherpur'],
};

export const ROLE_LABELS: Record<UserRole, { en: string; bn: string }> = {
  citizen: { en: 'Citizen', bn: 'নাগরিক' },
  triage_officer: { en: 'Triage Officer', bn: 'ট্রায়াজ কর্মকর্তা' },
  field_worker: { en: 'Field Worker', bn: 'মাঠকর্মী' },
  dept_officer: { en: 'Department Officer', bn: 'বিভাগীয় কর্মকর্তা' },
  dept_head: { en: 'Department Head', bn: 'বিভাগীয় প্রধান' },
  high_authority: { en: 'High Authority / Cabinet', bn: 'উচ্চ কর্তৃপক্ষ / মন্ত্রিপরিষদ' },
  admin: { en: 'System Administrator', bn: 'সিস্টেম অ্যাডমিন' },
};
