/**
 * Browser demo seeding was intentionally removed. Showcase fixtures are an
 * operator-owned server action: use scripts/seed-showcase.mjs. Keeping this
 * compatibility module free of Supabase imports guarantees it cannot write data
 * from a browser or pull seeding credentials/logic into the production bundle.
 */
export function isDemoLoaded(): boolean {
  return false;
}

export async function loadDemoData(): Promise<never> {
  throw new Error('Browser demo seeding is disabled. Ask an operator to run the showcase fixture tool.');
}
