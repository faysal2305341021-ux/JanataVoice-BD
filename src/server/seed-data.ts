import crypto from 'node:crypto';
import type {
  Assignment,
  Complaint,
  ComplaintCategory,
  ComplaintEvent,
  ComplaintLanguage,
  ComplaintPriority,
  ComplaintStatus,
  Department,
  Escalation,
  Feedback,
  FieldReport,
  NotificationRecord,
  SlaConfig,
  UserProfile,
  UserRole,
} from '../types/domain.ts';
import { buildComplaintEvent, GENESIS_HASH } from './hash-chain.ts';

export function hashPassword(password: string, salt = 'jv_bd_static_salt_2026'): string {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export const DEMO_PASSWORD_HASH = hashPassword('Demo@2026');

export const DEPARTMENTS: Department[] = [
  {
    id: 'dept_lgd',
    code: 'LGD',
    name: 'Local Government & City Corporations',
    nameBn: 'স্থানীয় সরকার ও সিটি কর্পোরেশন',
    description: 'Municipal roads, drainage, streetlights, solid waste, and public sanitation.',
    descriptionBn: 'পৌর ও সিটি কর্পোরেশনের রাস্তা, ড্রেনেজ, সড়কবাতি, বর্জ্য অপসারণ এবং পরিচ্ছন্নতা।',
  },
  {
    id: 'dept_power',
    code: 'POWER',
    name: 'Power & Energy Division (DESCO/DPDC/REB)',
    nameBn: 'বিদ্যুৎ ও জ্বালানি বিভাগ',
    description: 'Grid outages, transformer faults, hazardous exposed lines, and billing disputes.',
    descriptionBn: 'বিদ্যুৎ বিভ্রাট, ট্রান্সফরমার ত্রুটি, ঝুঁকিপূর্ণ খোলা তার এবং প্রিপেইড মিটার বিল সমস্যা।',
  },
  {
    id: 'dept_wasa',
    code: 'WASA',
    name: 'Water Supply & Sewerage Authority (WASA)',
    nameBn: 'ওয়াসা ও পানি সরবরাহ কর্তৃপক্ষ',
    description: 'Drinking water contamination, broken supply mains, and sewer overflow.',
    descriptionBn: 'খাবার পানির সংকট, দূষিত পানি, সরবরাহ পাইপলাইন এবং সুয়ারেজ ওভারফ্লো।',
  },
  {
    id: 'dept_health',
    code: 'HEALTH',
    name: 'Directorate General of Health Services (DGHS)',
    nameBn: 'স্বাস্থ্য অধিদপ্তর',
    description: 'Public hospital emergency care, medicine stockouts, and vector control.',
    descriptionBn: 'সরকারি হাসপাতালের জরুরি চিকিৎসা, বিনামূল্যের ওষুধ সংকট এবং ডেঙ্গু ও মশা নিধন।',
  },
  {
    id: 'dept_police',
    code: 'POLICE',
    name: 'Bangladesh Police & Public Safety',
    nameBn: 'বাংলাদেশ পুলিশ ও জননিরাপত্তা',
    description: 'Traffic gridlock, street harassment, extortion, and neighborhood safety.',
    descriptionBn: 'তীব্র যানজট, ছিনতাই ও ইভটিজিং, শব্দদূষণ এবং অনলাইন/মোবাইল আর্থিক প্রতারণা।',
  },
  {
    id: 'dept_land',
    code: 'LAND',
    name: 'Ministry of Land & Revenue Services',
    nameBn: 'ভূমি ও রাজস্ব সেবা মন্ত্রণালয়',
    description: 'E-mutation delays, khatian/porcha errors, and land encroachment.',
    descriptionBn: 'ই-নামজারি বিলম্ব, খতিয়ান/পর্চা সংশোধন এবং সরকারি খাস জমি ও খাল দখল উচ্ছেদ।',
  },
];

export const SLA_CONFIGS: SlaConfig[] = [
  { tier: 'CRITICAL', firstResponseHours: 2, resolutionDays: 1, reminderPercent: 80, citizenConfirmHours: 48 },
  { tier: 'STANDARD', firstResponseHours: 12, resolutionDays: 3, reminderPercent: 80, citizenConfirmHours: 72 },
  { tier: 'COMPLEX', firstResponseHours: 24, resolutionDays: 7, reminderPercent: 80, citizenConfirmHours: 96 },
  { tier: 'POLICY', firstResponseHours: 48, resolutionDays: 14, reminderPercent: 80, citizenConfirmHours: 120 },
];

export const CATEGORIES: ComplaintCategory[] = [
  // LGD (4)
  {
    id: 'cat_road_pothole',
    code: 'LGD_ROAD_DAMAGE',
    nameEn: 'Road Damage & Potholes',
    nameBn: 'রাস্তা ভাঙা ও গর্ত',
    departmentId: 'dept_lgd',
    slaTier: 'STANDARD',
    firstResponseHours: 12,
    resolutionDays: 5,
    keywordsEn: ['road', 'pothole', 'asphalt', 'highway', 'broken street', 'footpath'],
    keywordsBn: ['রাস্তা', 'ভাঙা', 'গর্ত', 'সড়ক', 'পিচ', 'ফুটপাত'],
    keywordsBanglish: ['rasta', 'vanga', 'gorto', 'pothole', 'sorok', 'footpath'],
  },
  {
    id: 'cat_drainage_flood',
    code: 'LGD_DRAINAGE_BLOCK',
    nameEn: 'Drainage Blockage & Waterlogging',
    nameBn: 'ড্রেন বন্ধ ও জলাবদ্ধতা',
    departmentId: 'dept_lgd',
    slaTier: 'CRITICAL',
    firstResponseHours: 4,
    resolutionDays: 2,
    keywordsEn: ['drain', 'waterlogging', 'flooded street', 'clogged', 'manhole', 'stagnant water'],
    keywordsBn: ['ড্রেন', 'জলাবদ্ধতা', 'নালা', 'পানি জমে', 'ম্যানহোল', 'বৃষ্টি'],
    keywordsBanglish: ['drain', 'jolaboddho', 'nala', 'pani jome', 'manhole', 'bristi'],
  },
  {
    id: 'cat_waste_garbage',
    code: 'LGD_WASTE_COLLECTION',
    nameEn: 'Garbage & Waste Collection Delay',
    nameBn: 'ময়লা ও বর্জ্য অপসারণ বিলম্ব',
    departmentId: 'dept_lgd',
    slaTier: 'STANDARD',
    firstResponseHours: 12,
    resolutionDays: 2,
    keywordsEn: ['garbage', 'waste', 'trash', 'dumpster', 'smell', 'sanitation'],
    keywordsBn: ['ময়লা', 'আবর্জনা', 'বর্জ্য', 'দুর্গন্ধ', 'ডাস্টবিন', 'পরিচ্ছন্নতা'],
    keywordsBanglish: ['moyla', 'aborjona', 'durghondho', 'dustbin', 'garbage', 'kora'],
  },
  {
    id: 'cat_streetlight',
    code: 'LGD_STREETLIGHT_OUT',
    nameEn: 'Non-Functional Streetlights',
    nameBn: 'সড়কবাতি বিকল',
    departmentId: 'dept_lgd',
    slaTier: 'STANDARD',
    firstResponseHours: 12,
    resolutionDays: 3,
    keywordsEn: ['streetlight', 'dark street', 'lamp post', 'bulb', 'night safety', 'street light'],
    keywordsBn: ['সড়কবাতি', 'লাইট', 'অন্ধকার', 'বাতি নষ্ট', 'পোল', 'ল্যাম্পপোস্ট'],
    keywordsBanglish: ['street light', 'bati nosto', 'ondhokar', 'lamp post', 'light nai'],
  },

  // POWER (3)
  {
    id: 'cat_power_outage',
    code: 'PWR_OUTAGE_LOADSHED',
    nameEn: 'Prolonged Power Outage / Feeder Fault',
    nameBn: 'দীর্ঘস্থায়ী বিদ্যুৎ বিভ্রাট',
    departmentId: 'dept_power',
    slaTier: 'CRITICAL',
    firstResponseHours: 2,
    resolutionDays: 1,
    keywordsEn: ['power outage', 'electricity', 'blackout', 'no power', 'feeder', 'load shedding'],
    keywordsBn: ['বিদ্যুৎ', 'লোডশেডিং', 'কারেন্ট নেই', 'বিদ্যুৎ বিভ্রাট', 'ফেডার', 'অন্ধকার'],
    keywordsBanglish: ['current nai', 'biddut', 'loadshedding', 'electricity', 'no power', 'feeder'],
  },
  {
    id: 'cat_power_hazard',
    code: 'PWR_LIVE_WIRE_HAZARD',
    nameEn: 'Sparking Transformer & Exposed Live Wire',
    nameBn: 'ট্রান্সফরমার বিস্ফোরণ ও খোলা বৈদ্যুতিক তার',
    departmentId: 'dept_power',
    slaTier: 'CRITICAL',
    firstResponseHours: 1,
    resolutionDays: 1,
    keywordsEn: ['transformer', 'spark', 'live wire', 'electric pole', 'short circuit', 'fire hazard'],
    keywordsBn: ['ট্রান্সফরমার', 'খোলা তার', 'শর্ট সার্কিট', 'আগুন', 'বৈদ্যুতিক খুঁটি', 'স্পার্ক'],
    keywordsBanglish: ['transformer', 'khola tar', 'short circuit', 'spark', 'agun', 'khuti'],
  },
  {
    id: 'cat_power_billing',
    code: 'PWR_METER_BILLING',
    nameEn: 'Prepaid Meter & Overbilling Dispute',
    nameBn: 'প্রিপেইড মিটার ও অতিরিক্ত বিল সমস্যা',
    departmentId: 'dept_power',
    slaTier: 'STANDARD',
    firstResponseHours: 24,
    resolutionDays: 5,
    keywordsEn: ['electric bill', 'prepaid meter', 'overbilling', 'meter fault', 'desco', 'dpdc'],
    keywordsBn: ['বিদ্যুৎ বিল', 'প্রিপেইড মিটার', 'অতিরিক্ত বিল', 'মিটার নষ্ট', 'ডেসকো', 'ডিপিডিসি'],
    keywordsBanglish: ['biddut bill', 'prepaid meter', 'beshi bill', 'desco', 'dpdc', 'meter'],
  },

  // WASA (3)
  {
    id: 'cat_water_shortage',
    code: 'WASA_NO_WATER',
    nameEn: 'Drinking Water Supply Cut-Off',
    nameBn: 'পানির সরবরাহ বন্ধ',
    departmentId: 'dept_wasa',
    slaTier: 'CRITICAL',
    firstResponseHours: 4,
    resolutionDays: 1,
    keywordsEn: ['no water', 'water supply', 'wasa', 'dry tap', 'water crisis', 'pump'],
    keywordsBn: ['পানি নেই', 'ওয়াসা', 'পানির সংকট', 'পাম্প', 'কল', 'পানি সরবরাহ'],
    keywordsBanglish: ['pani nai', 'wasa', 'pani ashe na', 'tap', 'pump', 'water'],
  },
  {
    id: 'cat_water_dirty',
    code: 'WASA_CONTAMINATED_WATER',
    nameEn: 'Foul / Contaminated Tap Water',
    nameBn: 'দূষিত ও দুর্গন্ধযুক্ত পানি',
    departmentId: 'dept_wasa',
    slaTier: 'CRITICAL',
    firstResponseHours: 3,
    resolutionDays: 2,
    keywordsEn: ['dirty water', 'contaminated', 'smelly water', 'muddy', 'worms', 'unclean water'],
    keywordsBn: ['দূষিত পানি', 'ময়লা পানি', 'পচা পানি', 'পোকা', 'গন্ধ', 'কাদা'],
    keywordsBanglish: ['moyla pani', 'pocha pani', 'dushito pani', 'gondho', 'dirty water', 'poka'],
  },
  {
    id: 'cat_sewer_overflow',
    code: 'WASA_SEWER_OVERFLOW',
    nameEn: 'Sewerage Line Burst & Overflow',
    nameBn: 'সুয়ারেজ লাইন ফেটে উপচে পড়া',
    departmentId: 'dept_wasa',
    slaTier: 'STANDARD',
    firstResponseHours: 8,
    resolutionDays: 3,
    keywordsEn: ['sewer', 'sewage', 'pipe burst', 'leakage', 'overflow', 'gutter'],
    keywordsBn: ['সুয়ারেজ', 'পাইপ ফাটা', 'ময়লা উপচে', 'লিক', 'নর্দমা', 'পয়ঃনিষ্কাশন'],
    keywordsBanglish: ['sewerage', 'pipe fata', 'sewage', 'leak', 'nordoma', 'overflow'],
  },

  // HEALTH (3)
  {
    id: 'cat_health_hospital',
    code: 'HLTH_EMERGENCY_NEGLECT',
    nameEn: 'Public Hospital Emergency & Doctor Absence',
    nameBn: 'সরকারি হাসপাতালে জরুরি সেবা ও ডাক্তার অনুপস্থিতি',
    departmentId: 'dept_health',
    slaTier: 'CRITICAL',
    firstResponseHours: 2,
    resolutionDays: 1,
    keywordsEn: ['hospital', 'doctor absent', 'emergency', 'clinic', 'patient', 'ambulance'],
    keywordsBn: ['হাসপাতাল', 'ডাক্তার নেই', 'জরুরি বিভাগ', 'চিকিৎসা', 'রোগী', 'অ্যাম্বুলেন্স'],
    keywordsBanglish: ['hospital', 'doctor nai', 'emergency', 'rogi', 'ambulance', 'chikitsa'],
  },
  {
    id: 'cat_health_medicine',
    code: 'HLTH_MEDICINE_STOCKOUT',
    nameEn: 'Essential Medicine & Vaccine Stockout',
    nameBn: 'বিনামূল্যের ওষুধ ও টিকা সংকট',
    departmentId: 'dept_health',
    slaTier: 'STANDARD',
    firstResponseHours: 12,
    resolutionDays: 4,
    keywordsEn: ['medicine', 'vaccine', 'stockout', 'pharmacy', 'insulin', 'ORS'],
    keywordsBn: ['ওষুধ', 'টিকা', 'ওষুধ নেই', 'ইনসুলিন', 'স্বাস্থ্যকেন্দ্র', 'সংকট'],
    keywordsBanglish: ['oshudh', 'tika', 'medicine nai', 'vaccine', 'health complex', 'stockout'],
  },
  {
    id: 'cat_health_dengue',
    code: 'HLTH_VECTOR_MOSQUITO',
    nameEn: 'Dengue Breeding & Mosquito Fogging Request',
    nameBn: 'ডেঙ্গু ও মশা নিধন স্প্রে',
    departmentId: 'dept_health',
    slaTier: 'STANDARD',
    firstResponseHours: 12,
    resolutionDays: 2,
    keywordsEn: ['dengue', 'mosquito', 'larva', 'fogging', 'aedes', 'spray'],
    keywordsBn: ['ডেঙ্গু', 'মশা', 'ফগিং', 'লার্ভা', 'স্প্রে', 'এডিস'],
    keywordsBanglish: ['dengue', 'mosha', 'fogging', 'spray', 'larva', 'aedes'],
  },

  // POLICE (4)
  {
    id: 'cat_police_traffic',
    code: 'POL_TRAFFIC_ENCROACH',
    nameEn: 'Illegal Parking & Severe Traffic Gridlock',
    nameBn: 'অবৈধ পার্কিং ও তীব্র যানজট',
    departmentId: 'dept_police',
    slaTier: 'STANDARD',
    firstResponseHours: 6,
    resolutionDays: 2,
    keywordsEn: ['traffic', 'jam', 'illegal parking', 'rickshaw', 'signal', 'gridlock'],
    keywordsBn: ['যানজট', 'ট্রাফিক', 'অবৈধ পার্কিং', 'সিগন্যাল', 'জ্যাম', 'রাস্তা দখল'],
    keywordsBanglish: ['traffic', 'jam', 'janjot', 'illegal parking', 'signal', 'rasta dokhol'],
  },
  {
    id: 'cat_police_safety',
    code: 'POL_STREET_HARASSMENT',
    nameEn: 'Eve-Teasing, Mugging & Public Safety Threat',
    nameBn: 'ছিনতাই, ইভটিজিং ও জননিরাপত্তা ঝুঁকি',
    departmentId: 'dept_police',
    slaTier: 'CRITICAL',
    firstResponseHours: 1,
    resolutionDays: 1,
    keywordsEn: ['mugging', 'snatching', 'harassment', 'eve teasing', 'robbery', 'unsafe'],
    keywordsBn: ['ছিনতাই', 'ইভটিজিং', 'হয়রানি', 'ডাকাতি', 'নিরাপত্তা', 'চাঁদাবাজি'],
    keywordsBanglish: ['chintai', 'eve teasing', 'harassment', 'chadabaji', 'dakati', 'thana'],
  },
  {
    id: 'cat_police_noise',
    code: 'POL_NOISE_NUISANCE',
    nameEn: 'Late-Night Loudspeaker & Noise Pollution',
    nameBn: 'রাতবিরাতে শব্দদূষণ ও মাইকিং',
    departmentId: 'dept_police',
    slaTier: 'STANDARD',
    firstResponseHours: 6,
    resolutionDays: 2,
    keywordsEn: ['noise', 'loudspeaker', 'horn', 'dj', 'night sound', 'disturbance'],
    keywordsBn: ['শব্দদূষণ', 'মাইক', 'হর্ন', 'ডিজে', 'উচ্চ শব্দ', 'ঘুম'],
    keywordsBanglish: ['shobdo', 'mike', 'loudspeaker', 'horn', 'dj', 'noise'],
  },
  {
    id: 'cat_police_cyber',
    code: 'POL_CYBER_FRAUD',
    nameEn: 'Mobile Banking & Online Scam Report',
    nameBn: 'মোবাইল ব্যাংকিং ও অনলাইন প্রতারণা',
    departmentId: 'dept_police',
    slaTier: 'COMPLEX',
    firstResponseHours: 12,
    resolutionDays: 7,
    keywordsEn: ['scam', 'fraud', 'bkash', 'nagad', 'hacked', 'phishing'],
    keywordsBn: ['প্রতারণা', 'বিকাশ', 'নগদ', 'হ্যাক', 'সাইবার', 'ফিশিং'],
    keywordsBanglish: ['bkash', 'nagad', 'scam', 'protarona', 'hack', 'cyber'],
  },

  // LAND (3)
  {
    id: 'cat_land_mutation',
    code: 'LND_EMUTATION_DELAY',
    nameEn: 'E-Mutation (Namjari) Delay & Bribe Demand',
    nameBn: 'ই-নামজারি বিলম্ব ও অনিয়ম',
    departmentId: 'dept_land',
    slaTier: 'COMPLEX',
    firstResponseHours: 24,
    resolutionDays: 7,
    keywordsEn: ['mutation', 'namjari', 'ac land', 'land office', 'bribe', 'file stuck'],
    keywordsBn: ['নামজারি', 'ই-নামজারি', 'ভূমি অফিস', 'এসি ল্যান্ড', 'ঘুষ', 'ফাইল আটকা'],
    keywordsBanglish: ['namjari', 'e-mutation', 'ac land', 'bhumi office', 'ghush', 'file atka'],
  },
  {
    id: 'cat_land_khatian',
    code: 'LND_KHATIAN_CORRECTION',
    nameEn: 'Khatian / Porcha Record Error',
    nameBn: 'খতিয়ান ও পর্চা রেকর্ডে ভুল',
    departmentId: 'dept_land',
    slaTier: 'POLICY',
    firstResponseHours: 48,
    resolutionDays: 14,
    keywordsEn: ['khatian', 'porcha', 'deed', 'land record', 'mouza', 'dag number'],
    keywordsBn: ['খতিয়ান', 'পর্চা', 'দাগ নম্বর', 'মৌজা', 'দলিল', 'জমি রেকর্ড'],
    keywordsBanglish: ['khatian', 'porcha', 'dag', 'mouza', 'dolil', 'jomi record'],
  },
  {
    id: 'cat_land_encroach',
    code: 'LND_ILLEGAL_ENCROACHMENT',
    nameEn: 'Public Canal / Khas Land Encroachment',
    nameBn: 'খাস জমি ও খাল দখল',
    departmentId: 'dept_land',
    slaTier: 'COMPLEX',
    firstResponseHours: 24,
    resolutionDays: 10,
    keywordsEn: ['encroachment', 'khas land', 'canal grab', 'illegal structure', 'eviction', 'river grab'],
    keywordsBn: ['দখল', 'খাস জমি', 'খাল দখল', 'অবৈধ স্থাপনা', 'উচ্ছেদ', 'নদী'],
    keywordsBanglish: ['dokhol', 'khas jomi', 'khal dokhol', 'oboedho', 'ucched', 'grab'],
  },
];

// 40 Users across all 7 roles & 8 divisions
const STAFF_SPECS: Array<{
  id: string;
  name: string;
  email: string;
  role: UserRole;
  dept?: string;
  division: string;
  district: string;
  phone: string;
  nid: string;
}> = [
  // Primary 7 Demo Accounts (1 per role)
  { id: 'usr_citizen_demo', name: 'Nusrat Jahan Mim', email: 'citizen@janatavoice.gov.bd', role: 'citizen', division: 'Dhaka', district: 'Dhaka', phone: '01711000101', nid: '1995269104' },
  { id: 'usr_triage_demo', name: 'Tariqul Islam', email: 'triage@janatavoice.gov.bd', role: 'triage_officer', division: 'Dhaka', district: 'Dhaka', phone: '01711000102', nid: '1988102201' },
  { id: 'usr_worker_lgd_demo', name: 'Kamrul Hasan', email: 'worker.lgd@janatavoice.gov.bd', role: 'field_worker', dept: 'dept_lgd', division: 'Dhaka', district: 'Dhaka', phone: '01711000103', nid: '1992301102' },
  { id: 'usr_officer_lgd_demo', name: 'Farhana Yasmin', email: 'officer.lgd@janatavoice.gov.bd', role: 'dept_officer', dept: 'dept_lgd', division: 'Dhaka', district: 'Dhaka', phone: '01711000104', nid: '1986401103' },
  { id: 'usr_head_lgd_demo', name: 'Engr. Mahmudul Haque', email: 'head.lgd@janatavoice.gov.bd', role: 'dept_head', dept: 'dept_lgd', division: 'Dhaka', district: 'Dhaka', phone: '01711000105', nid: '1978501104' },
  { id: 'usr_cabinet_demo', name: 'Dr. Shahriar Kabir', email: 'cabinet@janatavoice.gov.bd', role: 'high_authority', division: 'Dhaka', district: 'Dhaka', phone: '01711000106', nid: '1972601105' },
  { id: 'usr_admin_demo', name: 'Faysal Mahmud (Admin)', email: 'admin@janatavoice.gov.bd', role: 'admin', division: 'Dhaka', district: 'Dhaka', phone: '01711000107', nid: '1990701106' },

  // Remaining Department Officers (5 departments)
  { id: 'usr_officer_power', name: 'Rafiqul Alam', email: 'officer.power@janatavoice.gov.bd', role: 'dept_officer', dept: 'dept_power', division: 'Dhaka', district: 'Gazipur', phone: '01711000201', nid: '1985112201' },
  { id: 'usr_officer_wasa', name: 'Shamsun Nahar', email: 'officer.wasa@janatavoice.gov.bd', role: 'dept_officer', dept: 'dept_wasa', division: 'Chattogram', district: 'Chattogram', phone: '01711000202', nid: '1987112202' },
  { id: 'usr_officer_health', name: 'Dr. Tanvir Ahmed', email: 'officer.health@janatavoice.gov.bd', role: 'dept_officer', dept: 'dept_health', division: 'Rajshahi', district: 'Rajshahi', phone: '01711000203', nid: '1984112203' },
  { id: 'usr_officer_police', name: 'Inspector Moniruzzaman', email: 'officer.police@janatavoice.gov.bd', role: 'dept_officer', dept: 'dept_police', division: 'Sylhet', district: 'Sylhet', phone: '01711000204', nid: '1983112204' },
  { id: 'usr_officer_land', name: 'Nazmul Huda', email: 'officer.land@janatavoice.gov.bd', role: 'dept_officer', dept: 'dept_land', division: 'Khulna', district: 'Khulna', phone: '01711000205', nid: '1982112205' },

  // Department Heads (5 remaining departments)
  { id: 'usr_head_power', name: 'Engr. Ziaul Karim', email: 'head.power@janatavoice.gov.bd', role: 'dept_head', dept: 'dept_power', division: 'Dhaka', district: 'Dhaka', phone: '01711000301', nid: '1975112201' },
  { id: 'usr_head_wasa', name: 'Salma Chowdhury', email: 'head.wasa@janatavoice.gov.bd', role: 'dept_head', dept: 'dept_wasa', division: 'Dhaka', district: 'Dhaka', phone: '01711000302', nid: '1976112202' },
  { id: 'usr_head_health', name: 'Prof. Rubina Begum', email: 'head.health@janatavoice.gov.bd', role: 'dept_head', dept: 'dept_health', division: 'Dhaka', district: 'Dhaka', phone: '01711000303', nid: '1974112203' },
  { id: 'usr_head_police', name: 'DIG Anisur Rahman', email: 'head.police@janatavoice.gov.bd', role: 'dept_head', dept: 'dept_police', division: 'Dhaka', district: 'Dhaka', phone: '01711000304', nid: '1973112204' },
  { id: 'usr_head_land', name: 'Joint Sec. Rezaul Karim', email: 'head.land@janatavoice.gov.bd', role: 'dept_head', dept: 'dept_land', division: 'Dhaka', district: 'Dhaka', phone: '01711000305', nid: '1972112205' },

  // Field Workers (7 more across departments)
  { id: 'usr_worker_lgd_2', name: 'Sohel Mia', email: 'worker2.lgd@janatavoice.gov.bd', role: 'field_worker', dept: 'dept_lgd', division: 'Chattogram', district: 'Chattogram', phone: '01711000401', nid: '1993112201' },
  { id: 'usr_worker_power_1', name: 'Biplob Sarker', email: 'worker.power@janatavoice.gov.bd', role: 'field_worker', dept: 'dept_power', division: 'Dhaka', district: 'Narayanganj', phone: '01711000402', nid: '1991112202' },
  { id: 'usr_worker_wasa_1', name: 'Mizanur Rahman', email: 'worker.wasa@janatavoice.gov.bd', role: 'field_worker', dept: 'dept_wasa', division: 'Dhaka', district: 'Dhaka', phone: '01711000403', nid: '1990112203' },
  { id: 'usr_worker_health_1', name: 'Sabina Akter', email: 'worker.health@janatavoice.gov.bd', role: 'field_worker', dept: 'dept_health', division: 'Barishal', district: 'Barishal', phone: '01711000404', nid: '1994112204' },
  { id: 'usr_worker_police_1', name: 'SI Ashraful Islam', email: 'worker.police@janatavoice.gov.bd', role: 'field_worker', dept: 'dept_police', division: 'Rangpur', district: 'Rangpur', phone: '01711000405', nid: '1989112205' },
  { id: 'usr_worker_land_1', name: 'Sub-Surveyor Arif', email: 'worker.land@janatavoice.gov.bd', role: 'field_worker', dept: 'dept_land', division: 'Mymensingh', district: 'Mymensingh', phone: '01711000406', nid: '1991112206' },

  // Extra Triage Officer & High Authority
  { id: 'usr_triage_2', name: 'Mehedi Hasan', email: 'triage2@janatavoice.gov.bd', role: 'triage_officer', division: 'Chattogram', district: 'Cumilla', phone: '01711000501', nid: '1989223301' },
  { id: 'usr_cabinet_2', name: 'Secretary Nasreen Sultana', email: 'cabinet2@janatavoice.gov.bd', role: 'high_authority', division: 'Dhaka', district: 'Dhaka', phone: '01711000502', nid: '1970223302' },
];

const CITIZEN_NAMES: Array<[string, string, string]> = [
  ['Abdur Rahim', 'Dhaka', 'Dhaka'],
  ['Taslima Begum', 'Dhaka', 'Gazipur'],
  ['Rakibul Hassan', 'Chattogram', 'Chattogram'],
  ['Sadia Afrin', 'Sylhet', 'Sylhet'],
  ['Mahbubur Rahman', 'Rajshahi', 'Bogura'],
  ['Farzana Akter', 'Khulna', 'Jashore'],
  ['Imran Hossain', 'Barishal', 'Barishal'],
  ['Nadia Islam', 'Rangpur', 'Dinajpur'],
  ['Jahidul Islam', 'Mymensingh', 'Mymensingh'],
  ['Sumaiya Khatun', 'Chattogram', 'Cumilla'],
  ['Towhidul Alam', 'Dhaka', 'Narayanganj'],
  ['Mitu Chowdhury', 'Sylhet', 'Moulvibazar'],
  ['Kawsar Ahmed', 'Khulna', 'Khulna'],
  ['Rupa Das', 'Rajshahi', 'Rajshahi'],
  ['Shafiqul Islam', 'Rangpur', 'Rangpur'],
];

export const SEEDED_USERS: Array<UserProfile & { passwordHash: string }> = [
  ...STAFF_SPECS.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone,
    email: s.email,
    nidMock: s.nid,
    ekIdToken: `EKID-BD-2026-${s.nid.slice(-6)}`,
    ekIdVerified: true,
    role: s.role,
    departmentId: s.dept,
    division: s.division,
    district: s.district,
    createdAt: '2026-10-01T09:00:00.000Z',
    passwordHash: DEMO_PASSWORD_HASH,
  })),
  ...CITIZEN_NAMES.map(([name, division, district], idx) => {
    const num = String(1001 + idx);
    const nid = `199488${num}`;
    return {
      id: `usr_citizen_${idx + 2}`,
      name,
      phone: `0181200${num}`,
      email: `citizen${idx + 2}@example.bd`,
      nidMock: nid,
      ekIdToken: `EKID-BD-2026-${nid.slice(-6)}`,
      ekIdVerified: true,
      role: 'citizen' as UserRole,
      division,
      district,
      createdAt: '2026-10-05T10:00:00.000Z',
      passwordHash: DEMO_PASSWORD_HASH,
    };
  }),
];

const DIVISION_COORDS: Record<string, [number, number]> = {
  Dhaka: [23.8103, 90.4125],
  Chattogram: [22.3569, 91.7832],
  Rajshahi: [24.3745, 88.6042],
  Khulna: [22.8456, 89.5403],
  Sylhet: [24.8949, 91.8687],
  Barishal: [22.7010, 90.3535],
  Rangpur: [25.7439, 89.2752],
  Mymensingh: [24.7471, 90.4203],
};

const SAMPLE_TEXTS: Record<string, Array<{ lang: ComplaintLanguage; text: string }>> = {
  LGD_ROAD_DAMAGE: [
    { lang: 'bn', text: 'মিরপুর ১০ থেকে কাজীপাড়া যাওয়ার মূল রাস্তায় বিশাল গর্ত তৈরি হয়েছে, প্রতিদিন দুর্ঘটনা ঘটছে।' },
    { lang: 'en', text: 'Severe asphalt collapse and deep potholes near Dhanmondi Road 27 intersection blocking traffic.' },
    { lang: 'banglish', text: 'Uttara sector 7 er main rasta puro vanga, gari chola impossible hoye geche.' },
  ],
  LGD_DRAINAGE_BLOCK: [
    { lang: 'bn', text: 'বৃষ্টি হলেই শান্তিনগর মোড়ে হাঁটু সমান জলাবদ্ধতা হয়, ড্রেনগুলো সম্পূর্ণ বন্ধ হয়ে আছে।' },
    { lang: 'en', text: 'Clogged storm drains causing knee-deep waterlogging across Agrabad commercial lane.' },
    { lang: 'banglish', text: 'Ektu bristi holei Mohammadpur block D te drain er pani rasta upche pore.' },
  ],
  LGD_WASTE_COLLECTION: [
    { lang: 'bn', text: 'গত ৫ দিন ধরে আমাদের ওয়ার্ডের ডাস্টবিন থেকে ময়লা তোলা হচ্ছে না, তীব্র দুর্গন্ধ ছড়াচ্ছে।' },
    { lang: 'en', text: 'Municipal waste collection truck has skipped Ward 19 for five days; garbage overflowing onto sidewalk.' },
    { lang: 'banglish', text: 'Bashundhara gate er pashe 4 din dhore moyla porishkar kore nai, khub durghondho.' },
  ],
  LGD_STREETLIGHT_OUT: [
    { lang: 'bn', text: 'আমাদের এলাকার ১২টি সড়কবাতি দুই সপ্তাহ ধরে জ্বলছে না, রাতে চলাচল ঝুঁকিপূর্ণ।' },
    { lang: 'en', text: 'All LED streetlights along Station Road have been dark for two weeks creating safety hazards.' },
    { lang: 'banglish', text: 'Gulshan link road er street light gula 10 din dhore nosto, ratre ondhokar thake.' },
  ],
  PWR_OUTAGE_LOADSHED: [
    { lang: 'bn', text: 'গত ১৪ ঘণ্টা ধরে আমাদের এলাকায় বিদ্যুৎ নেই, ট্রান্সফরমার ফিডার বন্ধ হয়ে আছে।' },
    { lang: 'en', text: 'Continuous 14-hour power outage in Narayanganj Feeder-4 without prior notice from utility.' },
    { lang: 'banglish', text: 'Sokal theke biddut nai, current ashe r jay, feeder trip korse mone hoy.' },
  ],
  PWR_LIVE_WIRE_HAZARD: [
    { lang: 'bn', text: 'গলির মাথায় বৈদ্যুতিক ট্রান্সফরমারে স্পার্ক হচ্ছে এবং একটি খোলা তার ঝুলে আছে।' },
    { lang: 'en', text: 'Exposed live 11kV wire hanging low over school gate with sparking transformer box.' },
    { lang: 'banglish', text: 'Bazar er mor er transformer e agun r spark kortese, khola tar jhulche.' },
  ],
  PWR_METER_BILLING: [
    { lang: 'bn', text: 'প্রিপেইড মিটারে রিচার্জ করার পরও টাকা কাটছে এবং দ্বিগুণ বিদ্যুৎ বিল এসেছে।' },
    { lang: 'en', text: 'Prepaid smart meter deducting double units and showing anomalous tariff charges.' },
    { lang: 'banglish', text: 'Ei mashe prepaid meter e beshi bill katse, meter display error dekhacche.' },
  ],
  WASA_NO_WATER: [
    { lang: 'bn', text: 'গত ৩ দিন ধরে ওয়াসার লাইনে কোনো পানি আসছে না, পুরো মহল্লায় তীব্র পানির সংকট।' },
    { lang: 'en', text: 'Zero tap water supply from WASA main line for 72 hours across Khilgaon Block B.' },
    { lang: 'banglish', text: '3 din dhore WASA er tap e pani nai, pump chalu hocche na.' },
  ],
  WASA_CONTAMINATED_WATER: [
    { lang: 'bn', text: 'ওয়াসার ট্যাপ দিয়ে কালো ও দুর্গন্ধযুক্ত ময়লা পানি আসছে, পান করার অযোগ্য।' },
    { lang: 'en', text: 'Tap water smells strongly of sewage and contains visible dark sediment since yesterday.' },
    { lang: 'banglish', text: 'WASA line diye pocha gondho moyla pani asche, kichu poka o dekha jache.' },
  ],
  WASA_SEWER_OVERFLOW: [
    { lang: 'bn', text: 'প্রধান সড়কের সুয়ারেজ লাইন ফেটে ময়লা পানি রাস্তায় উপচে পড়ছে।' },
    { lang: 'en', text: 'Broken sewerage trunk pipe overflowing raw waste onto residential lane in Halishahar.' },
    { lang: 'banglish', text: 'Basha r samne sewerage pipe fete nordoma r pani rasta bheshe geche.' },
  ],
  HLTH_EMERGENCY_NEGLECT: [
    { lang: 'bn', text: 'উপজেলা স্বাস্থ্য কমপ্লেক্সের জরুরি বিভাগে রাত ১১টার পর কোনো ডিউটি ডাক্তার পাওয়া যাচ্ছে না।' },
    { lang: 'en', text: 'No on-duty physician available at Upazila Health Complex emergency ward for trauma patients.' },
    { lang: 'banglish', text: 'Sorkari hospital er emergency te ratre doctor nai, rogi der keu dekhtecche na.' },
  ],
  HLTH_MEDICINE_STOCKOUT: [
    { lang: 'bn', text: 'কমিউনিটি ক্লিনিকে ইনসুলিন ও প্রয়োজনীয় বিনামূল্যের ওষুধের সরবরাহ এক মাস ধরে বন্ধ।' },
    { lang: 'en', text: 'Community clinic out of essential insulin and pediatric oral rehydration supplies for three weeks.' },
    { lang: 'banglish', text: 'Health complex e free oshudh r insulin stock nai bole ferot dicche.' },
  ],
  HLTH_VECTOR_MOSQUITO: [
    { lang: 'bn', text: 'আমাদের এলাকায় ডেঙ্গু রোগী বাড়ছে কিন্তু সিটি কর্পোরেশনের মশা নিধন স্প্রে বা ফগিং হচ্ছে না।' },
    { lang: 'en', text: 'Rising dengue cases in Ward 14 with stagnant construction water and zero mosquito fogging.' },
    { lang: 'banglish', text: 'Para te dengue bere geche kintu mosha marar fogging spray ekbaro dey nai.' },
  ],
  POL_TRAFFIC_ENCROACH: [
    { lang: 'bn', text: 'অবৈধ পার্কিং ও ফুটপাত দখলের কারণে প্রতিদিন সকাল থেকে রাত পর্যন্ত তীব্র যানজট লেগে থাকে।' },
    { lang: 'en', text: 'Illegal double-parked buses blocking two lanes near Farmgate causing 2-hour gridlock.' },
    { lang: 'banglish', text: 'Station mor e oboedho parking er karone protidin bishal traffic jam hoy.' },
  ],
  POL_STREET_HARASSMENT: [
    { lang: 'bn', text: 'কলেজ গেটের সামনে সন্ধ্যার পর ছিনতাই ও ইভটিজিং বেড়ে গেছে, পুলিশ টহল জোরদার করা প্রয়োজন।' },
    { lang: 'en', text: 'Repeated mobile snatching and street harassment incidents reported near campus overpass after dusk.' },
    { lang: 'banglish', text: 'Sondhar por bridge er niche chintai r eve teasing bere geche, police patrol dorkar.' },
  ],
  POL_NOISE_NUISANCE: [
    { lang: 'bn', text: 'রাত ২টা পর্যন্ত উচ্চ শব্দে মাইক ও ডিজে বাজানো হচ্ছে, অসুস্থ রোগী ও পরীক্ষার্থীদের চরম ভোগান্তি।' },
    { lang: 'en', text: 'High-decibel loudspeaker sound system operating past 1 AM in residential neighborhood.' },
    { lang: 'banglish', text: 'Rat 2ta porjonto high volume DJ r mike bajacche, shobdo dushon e ghumano jay na.' },
  ],
  POL_CYBER_FRAUD: [
    { lang: 'bn', text: 'ভুয়া কাস্টমার কেয়ারের নামে ফোন করে আমার বিকাশ ও নগদ অ্যাকাউন্ট থেকে টাকা হাতিয়ে নেওয়া হয়েছে।' },
    { lang: 'en', text: 'Phishing impersonator stole BDT 35,000 via fraudulent mobile banking OTP verification call.' },
    { lang: 'banglish', text: 'Bkash customer care seje fraud kore amar taka niye geche, cyber cell help chai.' },
  ],
  LND_EMUTATION_DELAY: [
    { lang: 'bn', text: 'ই-নামজারি আবেদন জমা দেওয়ার ৪৫ দিন পার হলেও ভূমি অফিসে ফাইল আটকে আছে এবং অতিরিক্ত অর্থ চাওয়া হচ্ছে।' },
    { lang: 'en', text: 'E-mutation application pending beyond statutory 28 days at Upazila Land Office without hearing date.' },
    { lang: 'banglish', text: 'Namjari apply korsi 2 mash age, AC land office e file atke rakhse.' },
  ],
  LND_KHATIAN_CORRECTION: [
    { lang: 'bn', text: 'আরএস খতিয়ান ও পর্চায় আমার জমির দাগ নম্বর এবং মালিকের নাম ভুল মুদ্রিত হয়েছে।' },
    { lang: 'en', text: 'Clerical error in RS Khatian dag number and owner name requiring official correction order.' },
    { lang: 'banglish', text: 'Amar jomir khatian r porcha te dag number bhul uthse, correction dorkar.' },
  ],
  LND_ILLEGAL_ENCROACHMENT: [
    { lang: 'bn', text: 'প্রভাবশালীরা সরকারি খাস জমি ও খালের পাড় দখল করে অবৈধ স্থাপনা নির্মাণ করছে।' },
    { lang: 'en', text: 'Unauthorized concrete boundary wall encroaching on public drainage canal and khas land.' },
    { lang: 'banglish', text: 'Sorkari khal r khas jomi dokhol kore oboedho dokan banacche, ucched dorkar.' },
  ],
};

export interface SeedBundle {
  departments: Department[];
  slaConfigs: SlaConfig[];
  categories: ComplaintCategory[];
  users: Array<UserProfile & { passwordHash: string }>;
  complaints: Complaint[];
  events: ComplaintEvent[];
  assignments: Assignment[];
  fieldReports: FieldReport[];
  escalations: Escalation[];
  notifications: NotificationRecord[];
  feedbacks: Feedback[];
}

export function generateSeedBundle(): SeedBundle {
  const complaints: Complaint[] = [];
  const events: ComplaintEvent[] = [];
  const assignments: Assignment[] = [];
  const fieldReports: FieldReport[] = [];
  const escalations: Escalation[] = [];
  const notifications: NotificationRecord[] = [];
  const feedbacks: Feedback[] = [];

  const citizens = SEEDED_USERS.filter((u) => u.role === 'citizen');
  const statusPool: ComplaintStatus[] = [
    'SUBMITTED',
    'TRIAGING',
    'ASSIGNED',
    'IN_PROGRESS',
    'IN_PROGRESS',
    'RESOLVED',
    'CLOSED',
    'CLOSED',
    'REOPENED',
    'ESCALATED',
  ];

  // Fixed anchor relative to current local time (2026-11-17) so SLA windows look crisp
  const nowMs = new Date('2026-11-17T06:00:00.000Z').getTime();

  for (let i = 1; i <= 150; i++) {
    const id = `cmp_${String(i).padStart(4, '0')}`;
    const trackingId = `BD-2026-${String(i).padStart(6, '0')}`;
    const cat = CATEGORIES[(i - 1) % CATEGORIES.length];
    const citizen = citizens[(i - 1) % citizens.length];
    const sampleVariants = SAMPLE_TEXTS[cat.code];
    const variant = sampleVariants[(i - 1) % sampleVariants.length];

    let status: ComplaintStatus = statusPool[(i - 1) % statusPool.length];
    // Make sure complaints 1-18 include deliberate SLA-breached cases for demo
    const isDeliberateBreach = i <= 18 && i % 2 === 0;
    if (isDeliberateBreach && status === 'CLOSED') {
      status = 'IN_PROGRESS';
    }
    if (isDeliberateBreach && status === 'RESOLVED') {
      status = 'ASSIGNED';
    }

    const createdOffsetHours = 6 + (i % 240);
    const createdAtMs = nowMs - createdOffsetHours * 3600 * 1000;
    const createdAt = new Date(createdAtMs).toISOString();

    const slaWindowMs = cat.resolutionDays * 24 * 3600 * 1000;
    let slaDueMs = createdAtMs + slaWindowMs;
    if (isDeliberateBreach) {
      // Breached 2 to 18 hours ago!
      slaDueMs = nowMs - (2 + (i % 16)) * 3600 * 1000;
    } else if (status === 'IN_PROGRESS' && i % 5 === 0) {
      // Approaching breach (85% elapsed)
      slaDueMs = nowMs + 3 * 3600 * 1000;
    } else if (status === 'ASSIGNED' || status === 'SUBMITTED' || status === 'TRIAGING') {
      slaDueMs = nowMs + (12 + (i % 72)) * 3600 * 1000;
    }

    const firstResponseDueAt = new Date(createdAtMs + cat.firstResponseHours * 3600 * 1000).toISOString();
    const slaDueAt = new Date(slaDueMs).toISOString();

    const [baseLat, baseLng] = DIVISION_COORDS[citizen.division] || [23.8103, 90.4125];
    const locationLat = Number((baseLat + (((i * 17) % 100) - 50) * 0.0025).toFixed(5));
    const locationLng = Number((baseLng + (((i * 29) % 100) - 50) * 0.0025).toFixed(5));

    const deptOfficer =
      SEEDED_USERS.find((u) => u.role === 'dept_officer' && u.departmentId === cat.departmentId) ||
      SEEDED_USERS.find((u) => u.role === 'dept_officer')!;
    const deptWorker =
      SEEDED_USERS.find((u) => u.role === 'field_worker' && u.departmentId === cat.departmentId) ||
      SEEDED_USERS.find((u) => u.role === 'field_worker')!;

    const aiConfidence = status === 'TRIAGING' ? Number((0.45 + (i % 20) * 0.01).toFixed(2)) : Number((0.78 + (i % 20) * 0.01).toFixed(2));
    const priority: ComplaintPriority =
      cat.slaTier === 'CRITICAL'
        ? 'CRITICAL'
        : cat.slaTier === 'STANDARD'
          ? i % 3 === 0
            ? 'HIGH'
            : 'MEDIUM'
          : 'LOW';

    const currentLevel =
      status === 'ESCALATED' ? 3 : status === 'REOPENED' ? 3 : status === 'IN_PROGRESS' ? 1 : status === 'ASSIGNED' ? 2 : 1;

    const resolvedAt =
      status === 'RESOLVED' || status === 'CLOSED'
        ? new Date(createdAtMs + Math.max(2, Math.floor(slaWindowMs / 3600000 / 2)) * 3600 * 1000).toISOString()
        : undefined;
    const closedAt =
      status === 'CLOSED'
        ? new Date(createdAtMs + Math.max(4, Math.floor((slaWindowMs / 3600000) * 0.7)) * 3600 * 1000).toISOString()
        : undefined;

    const runnerUpCat = CATEGORIES[(i + 2) % CATEGORIES.length];
    const aiRawResponse =
      status === 'TRIAGING'
        ? JSON.stringify({
            engine: 'gemini-4-hydrogen',
            top_candidate: cat.code,
            runner_up: runnerUpCat.code,
            confidence: aiConfidence,
            detected_language: variant.lang,
            reasoning: `Low-confidence classification (${Math.round(aiConfidence * 100)}% < 70% threshold). Text signals overlap between ${cat.code} (${cat.nameEn}) and ${runnerUpCat.code} (${runnerUpCat.nameEn}). Held in human triage queue for triage_officer confirmation.`,
          })
        : JSON.stringify({
            engine: 'gemini-4-hydrogen',
            top_candidate: cat.code,
            confidence: aiConfidence,
            detected_language: variant.lang,
            reasoning: `High-confidence semantic match for ${cat.code} (${cat.nameEn}) routed to ${cat.departmentId}.`,
          });

    const complaint: Complaint = {
      id,
      trackingId,
      citizenId: citizen.id,
      citizenName: citizen.name,
      citizenPhone: citizen.phone,
      division: citizen.division,
      district: citizen.district,
      rawText: variant.text,
      language: variant.lang,
      categoryId: status === 'TRIAGING' ? undefined : cat.id,
      categoryCode: status === 'TRIAGING' ? undefined : cat.code,
      departmentId: status === 'TRIAGING' ? undefined : cat.departmentId,
      aiConfidence,
      aiReasonCode: status === 'TRIAGING' ? `LOW_CONFIDENCE_AMBIGUOUS (${cat.code} vs ${runnerUpCat.code})` : `MATCHED_${cat.code}`,
      aiModelVersion: 'gemini-4-hydrogen-v1',
      aiRawResponse,
      priority,
      status,
      slaDueAt,
      firstResponseDueAt,
      currentLevel,
      assignedOfficerId: status !== 'SUBMITTED' && status !== 'TRIAGING' ? deptOfficer.id : undefined,
      assignedWorkerId:
        status === 'IN_PROGRESS' || status === 'RESOLVED' || status === 'CLOSED' || status === 'ESCALATED'
          ? deptWorker.id
          : undefined,
      locationLat,
      locationLng,
      addressText: `${citizen.district} Ward ${1 + (i % 25)}, ${citizen.division}`,
      createdAt,
      resolvedAt,
      closedAt,
    };

    complaints.push(complaint);

    // Build genuine SHA-256 hash-chained events per complaint
    let prevHash = GENESIS_HASH;
    const ev1 = buildComplaintEvent({
      id: `evt_${i}_1`,
      complaintId: id,
      actorId: citizen.id,
      actorName: citizen.name,
      actorRole: 'citizen',
      eventType: 'COMPLAINT_SUBMITTED',
      fromStatus: '',
      toStatus: status === 'TRIAGING' ? 'TRIAGING' : 'SUBMITTED',
      payload: { trackingId, language: variant.lang, aiConfidence, departmentId: complaint.departmentId || 'PENDING_TRIAGE' },
      prevHash,
      createdAt,
    });
    events.push(ev1);
    prevHash = ev1.hash;

    if (complaint.assignedOfficerId) {
      const assignedAt = new Date(createdAtMs + 1800 * 1000).toISOString();
      assignments.push({
        id: `asgn_${i}_1`,
        complaintId: id,
        assigneeId: complaint.assignedOfficerId,
        assigneeRole: 'dept_officer',
        assignedBy: 'system_ai_router',
        assignedAt,
      });
      const ev2 = buildComplaintEvent({
        id: `evt_${i}_2`,
        complaintId: id,
        actorId: 'system_ai_router',
        actorName: 'AI Routing Engine',
        actorRole: 'system',
        eventType: 'AUTO_ASSIGNED',
        fromStatus: 'SUBMITTED',
        toStatus: 'ASSIGNED',
        payload: { assigneeId: complaint.assignedOfficerId, departmentId: cat.departmentId },
        prevHash,
        createdAt: assignedAt,
      });
      events.push(ev2);
      prevHash = ev2.hash;
    }

    if (complaint.assignedWorkerId && (status === 'IN_PROGRESS' || status === 'RESOLVED' || status === 'CLOSED' || status === 'ESCALATED')) {
      const workAt = new Date(createdAtMs + 5400 * 1000).toISOString();
      assignments.push({
        id: `asgn_${i}_2`,
        complaintId: id,
        assigneeId: complaint.assignedWorkerId,
        assigneeRole: 'field_worker',
        assignedBy: complaint.assignedOfficerId || deptOfficer.id,
        assignedAt: workAt,
      });
      const ev3 = buildComplaintEvent({
        id: `evt_${i}_3`,
        complaintId: id,
        actorId: deptOfficer.id,
        actorName: deptOfficer.name,
        actorRole: 'dept_officer',
        eventType: 'DISPATCHED_TO_FIELD',
        fromStatus: 'ASSIGNED',
        toStatus: 'IN_PROGRESS',
        payload: { workerId: complaint.assignedWorkerId },
        prevHash,
        createdAt: workAt,
      });
      events.push(ev3);
      prevHash = ev3.hash;
    }

    if (status === 'RESOLVED' || status === 'CLOSED') {
      const repAt = resolvedAt!;
      fieldReports.push({
        id: `fr_${i}_1`,
        complaintId: id,
        workerId: deptWorker.id,
        workerName: deptWorker.name,
        notes: `Site inspection completed in ${citizen.district}. Issue mitigated and verified with local residents.`,
        beforePhotoUrl: '',
        afterPhotoUrl: '',
        geoLat: locationLat,
        geoLng: locationLng,
        submittedAt: repAt,
      });
      const ev4 = buildComplaintEvent({
        id: `evt_${i}_4`,
        complaintId: id,
        actorId: deptWorker.id,
        actorName: deptWorker.name,
        actorRole: 'field_worker',
        eventType: 'FIELD_REPORT_SUBMITTED',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'RESOLVED',
        payload: { fieldReportId: `fr_${i}_1`, geoLat: locationLat, geoLng: locationLng },
        prevHash,
        createdAt: repAt,
      });
      events.push(ev4);
      prevHash = ev4.hash;

      if (status === 'CLOSED') {
        feedbacks.push({
          id: `fb_${i}_1`,
          complaintId: id,
          citizenId: citizen.id,
          satisfied: true,
          comment: 'Resolved within expected window. Thank you.',
          createdAt: closedAt!,
        });
        const ev5 = buildComplaintEvent({
          id: `evt_${i}_5`,
          complaintId: id,
          actorId: citizen.id,
          actorName: citizen.name,
          actorRole: 'citizen',
          eventType: 'CITIZEN_CONFIRMED_CLOSE',
          fromStatus: 'RESOLVED',
          toStatus: 'CLOSED',
          payload: { satisfied: true },
          prevHash,
          createdAt: closedAt!,
        });
        events.push(ev5);
        prevHash = ev5.hash;
      }
    }

    if (status === 'ESCALATED' || status === 'REOPENED') {
      const escAt = new Date(createdAtMs + 28 * 3600 * 1000).toISOString();
      escalations.push({
        id: `esc_${i}_1`,
        complaintId: id,
        fromLevel: 2,
        toLevel: 3,
        fromRole: 'dept_officer',
        toRole: 'dept_head',
        reason: status === 'REOPENED' ? 'Citizen reopened resolution — appellate review' : 'SLA resolution window breached',
        escalatedAt: escAt,
      });
      const evEsc = buildComplaintEvent({
        id: `evt_${i}_esc`,
        complaintId: id,
        actorId: status === 'REOPENED' ? citizen.id : 'system_sla_engine',
        actorName: status === 'REOPENED' ? citizen.name : 'SLA Escalation Engine',
        actorRole: status === 'REOPENED' ? 'citizen' : 'system',
        eventType: status === 'REOPENED' ? 'CITIZEN_REOPENED' : 'SLA_BREACH_ESCALATION',
        fromStatus: 'IN_PROGRESS',
        toStatus: status,
        payload: { fromLevel: 2, toLevel: 3 },
        prevHash,
        createdAt: escAt,
      });
      events.push(evEsc);
      prevHash = evEsc.hash;
    }

    if (i <= 20) {
      notifications.push({
        id: `notif_${i}_1`,
        userId: citizen.id,
        complaintId: id,
        trackingId,
        channel: 'IN_APP',
        recipientAddress: citizen.email,
        message: `Complaint ${trackingId} registered with status ${status}.`,
        isRead: i > 8,
        createdAt,
      });
    }
  }

  return {
    departments: DEPARTMENTS,
    slaConfigs: SLA_CONFIGS,
    categories: CATEGORIES,
    users: SEEDED_USERS,
    complaints,
    events,
    assignments,
    fieldReports,
    escalations,
    notifications,
    feedbacks,
  };
}
