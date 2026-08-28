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
};

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
]);
/* Fields that are stored as booleans */
const BOOL_FIELDS = new Set<keyof Settings>(['admissionOpen', 'statAutoFromDb']);

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
