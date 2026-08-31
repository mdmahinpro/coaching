/**
 * Resolve the home-hero stat values from live DB counts OR the admin-entered
 * settings, depending on `statAutoFromDb`.
 *
 * When auto-from-DB is ON, the three counts come from the polled DB query
 * (students = approved+active, teachers = active, batches = active); success
 * rate has no pass/fail aggregate, so it always comes from settings. When
 * auto-from-DB is OFF, all three counts use the admin-entered stat values.
 *
 * Pure + unit-tested so the branching has no Supabase dependency.
 */

export interface HomeStatsCounts {
  students: number;
  teachers: number;
  batches: number;
}

export interface HomeStatsSettings {
  statStudents: number;
  statTeachers: number;
  statBatches: number;
  statSuccessRate: number;
}

export interface HomeStats {
  students: number;
  teachers: number;
  batches: number;
  successRate: number;
  usedFromDb: boolean;
}

export function resolveHomeStats(
  counts: HomeStatsCounts | null,
  autoFromDb: boolean,
  settings: HomeStatsSettings
): HomeStats {
  const students = autoFromDb ? (counts?.students ?? 0) : settings.statStudents;
  const teachers = autoFromDb ? (counts?.teachers ?? 0) : settings.statTeachers;
  const batches = autoFromDb ? (counts?.batches ?? 0) : settings.statBatches;
  return {
    students,
    teachers,
    batches,
    successRate: settings.statSuccessRate,
    usedFromDb: autoFromDb,
  };
}