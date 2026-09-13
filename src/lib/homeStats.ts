/**
 * Resolve the home-hero stat values from live DB counts OR the admin-entered
 * settings, depending on `statAutoFromDb`.
 *
 * When auto-from-DB is ON, the counts come from the polled quy (students =
 * approved+active via the secured server aggregate; teachers = active; batches
 * = active); success rate has no pass/fail aggregate, so it always comes from
 * settings. When auto-from-DB is OFF, all three counts use the admin-entered
 * stat values.
 *
 * `failed` lets callers show an honest unavailable state instead of treating a
 * failed request as an empty/zero result.
 *
 * Pure + unit-tested so the branching has no Supabase dependency.
 */

export interface HomeStatsCounts {
  students: number;
  teachers: number;
  batches: number;
}

/** Result of a DB-fetch attempt, distinguishing failure from empty data. */
export type HomeStatsFetch = { ok: true; counts: HomeStatsCounts } | { ok: false };

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
  failed: boolean;
}

export function resolveHomeStats(
  fetchResult: HomeStatsFetch | null,
  autoFromDb: boolean,
  settings: HomeStatsSettings
): HomeStats {
  if (!autoFromDb) {
    return {
      students: settings.statStudents,
      teachers: settings.statTeachers,
      batches: settings.statBatches,
      successRate: settings.statSuccessRate,
      usedFromDb: false,
      failed: false,
    };
  }
  if (!fetchResult || !fetchResult.ok) {
    return {
      students: 0,
      teachers: 0,
      batches: 0,
      successRate: settings.statSuccessRate,
      usedFromDb: true,
      failed: true,
    };
  }
  const { students, teachers, batches } = fetchResult.counts;
  return {
    students,
    teachers,
    batches,
    successRate: settings.statSuccessRate,
    usedFromDb: true,
    failed: false,
  };
}
