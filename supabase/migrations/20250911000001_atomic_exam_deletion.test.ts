import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
const migration = read('supabase/migrations/20250911000001_atomic_exam_deletion.sql');
const examsPage = read('src/pages/admin/ExamsPage.tsx');
const admissionsPage = read('src/pages/admin/AdmissionsPage.tsx');

const deleteHandler = examsPage.slice(
  examsPage.indexOf('const handleDelete = async'),
  examsPage.indexOf('// Start a not-started exam')
);
const approveHandler = admissionsPage.slice(
  admissionsPage.indexOf('const handleApprove = async'),
  admissionsPage.indexOf('const handleReject = async')
);

describe('atomic admin mutation contracts', () => {
  it('defines a locked, admin-gated exam deletion RPC with least-privilege grants', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_delete_exam');
    expect(migration).toContain('IF NOT public.is_admin()');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('DELETE FROM public.exams');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, extensions');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.admin_delete_exam(UUID) FROM PUBLIC, anon');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.admin_delete_exam(UUID) TO authenticated');
  });

  it('uses only the transactional exam RPC from the delete handler', () => {
    expect(deleteHandler).toContain("supabase.rpc('admin_delete_exam'");
    expect(deleteHandler).not.toContain(".from('mcq_submissions')");
    expect(deleteHandler).not.toContain(".from('mcq_questions')");
    expect(deleteHandler).not.toContain(".from('exams').delete()");
  });

  it('uses only the atomic admission approval RPC for approval writes', () => {
    expect(approveHandler).toContain("'admin_approve_admission'");
    expect(approveHandler).not.toContain("'register_student'");
    expect(approveHandler).not.toContain("'increment_enrolled'");
    expect(approveHandler).not.toContain(".update({ status: 'approved' })");
  });
});
