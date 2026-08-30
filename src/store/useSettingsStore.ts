import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';

export interface Settings {
  // Coaching short name used to build student IDs (e.g. 'TLY').
  shortName: string;
  centerName: string;
  centerTagline: string;
  centerAddress: string;
  centerPhone: string;
  centerEmail: string;
  centerWhatsapp: string;
  currency: string;
  logoUrl: string;
  bannerUrl: string;
  heroTitle: string;
  heroSubtitle: string;
  admissionOpen: boolean;
  bkashNumber: string;
  nagadNumber: string;
  admissionFee: number;
  statStudents: number;
  statTeachers: number;
  statBatches: number;
  statSuccessRate: number;
  statAutoFromDb: boolean;
  socialFacebook: string;
  socialYoutube: string;
  socialInstagram: string;
  primaryColor: string;
  // Receipt + offline-payment presentation.
  receiptFooter: string;
  paymentInstructions: string;
  // Create-exam defaults.
  defaultExamDuration: number;
  defaultStrictMode: boolean;
  // Per-gateway enable/disable for the portal fees page.
  bkashEnabled: boolean;
  nagadEnabled: boolean;
  // Managed class-level list (শ্রেণী), comma-separated; every form renders a
  // <select> from these and the admin can edit/add them in Settings.
  classLevels: string;
}

interface SettingsState {
  settings: Settings;
  dbLoaded: boolean;
  updateSettings: (partial: Partial<Settings>) => void;
  loadFromDB: () => Promise<void>;
  saveToDB: (s: Settings) => Promise<void>;
}

export const defaults: Settings = {
  shortName: 'TLY',
  centerName: 'Techely Learning Academy',
  centerTagline: 'Excellence in Education',
  centerAddress: '389 5th Ave, New York, 10016, USA',
  centerPhone: '+16502977656',
  centerEmail: 'coaching@techely.com',
  centerWhatsapp: '8801768836443',
  currency: 'BDT',
  logoUrl: '',
  bannerUrl: '',
  heroTitle: 'Excellence in Education',
  heroSubtitle: 'Expert teachers, modern methods, guaranteed success',
  admissionOpen: true,
  bkashNumber: '01768836443',
  nagadNumber: '01768836443',
  admissionFee: 500,
  statStudents: 0,
  statTeachers: 0,
  statBatches: 0,
  statSuccessRate: 95,
  statAutoFromDb: true,
  socialFacebook: '',
  socialYoutube: '',
  socialInstagram: '',
  primaryColor: '#38bdf8',
  receiptFooter: '',
  paymentInstructions:
    'পেমেন্ট করতে: bKash / Nagad নম্বরে টাকা পাঠিয়ে রশিদ নিশ্চিত করুন, তারপর নিচের বাটনে ক্লিক করে ট্রানজেকশন আইডি জমা দিন।',
  defaultExamDuration: 30,
  defaultStrictMode: false,
  bkashEnabled: true,
  nagadEnabled: true,
  classLevels:
    'Class 6,Class 7,Class 8,JSC,Class 9,Class 10,SSC,Class 11,Class 12,HSC,IELTS,Admission Test',
};

/* ── key mapping: Settings field ↔ site_settings.key ── */
export const SETTINGS_KEY_MAP: Record<keyof Settings, string> = {
  shortName: 'coaching_short_name',
  centerName: 'institute_name',
  centerTagline: 'tagline',
  centerAddress: 'address',
  centerPhone: 'phone',
  centerEmail: 'email',
  centerWhatsapp: 'whatsapp',
  currency: 'currency',
  logoUrl: 'logo_url',
  bannerUrl: 'banner_url',
  heroTitle: 'hero_title',
  heroSubtitle: 'hero_subtitle',
  admissionOpen: 'admission_open',
  bkashNumber: 'bkash_number',
  nagadNumber: 'nagad_number',
  admissionFee: 'admission_fee',
  statStudents: 'stat_students',
  statTeachers: 'stat_teachers',
  statBatches: 'stat_batches',
  statSuccessRate: 'stat_success_rate',
  statAutoFromDb: 'stat_auto_from_db',
  socialFacebook: 'social_facebook',
  socialYoutube: 'social_youtube',
  socialInstagram: 'social_instagram',
  primaryColor: 'primary_color',
  receiptFooter: 'receipt_footer',
  paymentInstructions: 'payment_instructions',
  defaultExamDuration: 'default_exam_duration',
  defaultStrictMode: 'default_exam_strict_mode',
  bkashEnabled: 'bkash_enabled',
  nagadEnabled: 'nagad_enabled',
  classLevels: 'class_levels',
};

// Re-exported from lib/utils: pure, unit-tested. See useSettingsStore for the
// comma-separated class-levels setting (শ্রেণী) that every form renders from.
export { classLevelList } from '@/lib/utils';

/* Reverse map: db key → settings field */
const DB_TO_FIELD = Object.fromEntries(
  Object.entries(SETTINGS_KEY_MAP).map(([field, dbKey]) => [dbKey, field])
) as Record<string, keyof Settings>;

/* Fields that are stored as numbers in Settings */
const NUMBER_FIELDS = new Set<keyof Settings>([
  'admissionFee',
  'statStudents',
  'statTeachers',
  'statBatches',
  'statSuccessRate',
  'defaultExamDuration',
]);
/* Fields that are stored as booleans */
const BOOL_FIELDS = new Set<keyof Settings>([
  'admissionOpen',
  'statAutoFromDb',
  'defaultStrictMode',
  'bkashEnabled',
  'nagadEnabled',
]);

function castValue(field: keyof Settings, raw: string): Settings[keyof Settings] {
  if (BOOL_FIELDS.has(field)) {
    return (raw === 'true') as any;
  }
  if (NUMBER_FIELDS.has(field)) {
    return (Number(raw) ?? 0) as any;
  }
  return raw as any;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: { ...defaults },
      dbLoaded: false,

      updateSettings: (partial) =>
        set((state) => ({ settings: { ...state.settings, ...partial } })),

      loadFromDB: async () => {
        try {
          const { data, error } = await supabase.from('site_settings').select('key,value');
          if (error || !data) {
            return;
          }

          const patch: Partial<Settings> = {};
          for (const row of data) {
            const field = DB_TO_FIELD[row.key];
            if (field && row.value !== null && row.value !== '') {
              (patch as any)[field] = castValue(field, row.value);
            }
          }

          set((state) => ({
            settings: { ...state.settings, ...patch },
            dbLoaded: true,
          }));

          /* Apply primary color to CSS immediately */
          const color = patch.primaryColor ?? get().settings.primaryColor;
          if (color) {
            document.documentElement.style.setProperty('--primary', color);
          }
        } catch (err) {
          handleSupabaseError(err);
        }
      },

      saveToDB: async (s: Settings) => {
        try {
          const entries = (Object.keys(SETTINGS_KEY_MAP) as Array<keyof Settings>).map((field) => ({
            key: SETTINGS_KEY_MAP[field],
            value: String(s[field]),
          }));

          /* Batch upsert in one call */
          const { error } = await supabase
            .from('site_settings')
            .upsert(entries, { onConflict: 'key' });
          if (error) {
            throw new Error(error.message);
          }
        } catch (err) {
          handleSupabaseError(err);
        }
      },
    }),
    { name: 'coaching-center-settings' }
  )
);
