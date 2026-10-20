import { supabase } from './supabase';
import { getStudentToken } from '@/store/useStudentStore';

/**
 * Exam integrity API.
 *
 * The MCQ answer key (correct_option) and grading are now server-side.
 * The client never receives correct_option before submitting, never computes
 * its own score/rank, and submits answers through a SECURITY DEFINER RPC that
 * grades against the authoritative key and enforces the exam window.
 *
 * Identity is established one of two ways, both resolved server-side:
 *   • logged-in student → portal session token
 *   • manual verify      → Student ID string (mints an exam-scoped token)
 * Both yield a short-lived `exam_token` scoped to a single exam.
 */

export interface ExamMeta {
  id: string;
  title: string;
  subject: string;
  batch_name: string | null;
  duration_minutes: number;
  total_marks: number;
  pass_marks: number;
  instructions: string | null;
  status: string;
  start_time: string | null;
  end_time: string | null;
  timer_enabled: boolean;
}

export interface ExamJoinResult {
  exam_token: string;
  student_id: string;
  student_name: string;
  student_code: string;
  already_submitted: boolean;
  exam_status: string;
}

function unwrap<T>(data: T | null, error: { message?: string } | null): T {
  if (error) {
    throw new Error(error.message || 'Request failed');
  }
  return data as T;
}

export async function getExamMeta(examId: string): Promise<ExamMeta | null> {
  const { data, error } = await supabase.rpc('exam_get_meta', { p_exam_id: examId });
  return unwrap(data, error)?.[0] ?? null;
}

/**
 * Establish identity for an exam and mint an exam-scoped token.
 * The live database authorises from the portal session token only
 * (exam_join(p_exam_id, p_portal_token)); there is no anonymous Student-ID path.
 */
export async function joinExam(examId: string): Promise<ExamJoinResult> {
  const { data, error } = await supabase.rpc('exam_join', {
    p_exam_id: examId,
    p_portal_token: getStudentToken(),
  });
  const row = unwrap(data, error)?.[0];
  if (!row) {
    throw new Error('EXAM_JOIN_FAILED');
  }
  return row as ExamJoinResult;
}

export async function getExamQuestions(examToken: string) {
  const { data, error } = await supabase.rpc('exam_get_questions', { p_exam_token: examToken });
  return unwrap(data, error) ?? [];
}

export interface ExamSubmitResult {
  id: string;
  score: number;
  correct_count: number;
  wrong_count: number;
  time_taken: number;
  rank: number;
}

export async function submitExam(
  examToken: string,
  answers: Record<string, string>,
  timeTaken: number
): Promise<ExamSubmitResult> {
  const { data, error } = await supabase.rpc('exam_submit', {
    p_exam_token: examToken,
    p_answers: answers,
    p_time_taken: timeTaken,
    // The live function has a 4-arg overload (p_red_cards); omitting it makes
    // PostgREST return PGRST203 "could not choose the best candidate".
    p_red_cards: 0,
  });
  const row = unwrap(data, error)?.[0];
  if (!row) {
    throw new Error('EXAM_SUBMIT_FAILED');
  }
  return row as ExamSubmitResult;
}

export async function getLeaderboard(examId: string) {
  const { data, error } = await supabase.rpc('exam_get_leaderboard', { p_exam_id: examId });
  return unwrap(data, error) ?? [];
}

/** The caller's own graded submission for an exam, resolved from the exam token. */
export async function getMySubmission(examToken: string): Promise<ExamSubmitResult & { answers: unknown } | null> {
  const { data, error } = await supabase.rpc('exam_get_my_submission', { p_exam_token: examToken });
  return (unwrap(data, error)?.[0] as (ExamSubmitResult & { answers: unknown }) | undefined) ?? null;
}

/** Answer-review key, only for a student who already submitted this exam. */
export async function getExamReview(examId: string, examToken?: string) {
  const { data, error } = await supabase.rpc('exam_get_review', {
    p_exam_id: examId,
    p_portal_token: examToken ? null : getStudentToken(),
    p_exam_token: examToken ?? null,
  });
  return unwrap(data, error) ?? [];
}
