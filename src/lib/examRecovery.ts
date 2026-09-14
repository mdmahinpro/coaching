export interface ExamDraft {
  version: 1;
  examId: string;
  studentId: string;
  answers: Record<string, string>;
  savedAt: number;
}

const keyFor = (examId: string, studentId: string) => `exam-draft:v1:${examId}:${studentId}`;

export function saveExamDraft(examId: string, studentId: string, answers: Record<string, string>, now = Date.now()): void {
  const draft: ExamDraft = { version: 1, examId, studentId, answers, savedAt: now };
  localStorage.setItem(keyFor(examId, studentId), JSON.stringify(draft));
}

export function loadExamDraft(
  examId: string,
  studentId: string,
  questionIds: ReadonlySet<string>,
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000
): Record<string, string> | null {
  const raw = localStorage.getItem(keyFor(examId, studentId));
  if (!raw) {return null;}
  try {
    const draft = JSON.parse(raw) as Partial<ExamDraft>;
    if (
      draft.version !== 1 ||
      draft.examId !== examId ||
      draft.studentId !== studentId ||
      typeof draft.savedAt !== 'number' ||
      draft.savedAt > now ||
      now - draft.savedAt > maxAgeMs ||
      !draft.answers ||
      typeof draft.answers !== 'object'
    ) {
      clearExamDraft(examId, studentId);
      return null;
    }
    const answers: Record<string, string> = {};
    for (const [questionId, answer] of Object.entries(draft.answers)) {
      if (questionIds.has(questionId) && ['A', 'B', 'C', 'D'].includes(answer)) {answers[questionId] = answer;}
    }
    return answers;
  } catch {
    clearExamDraft(examId, studentId);
    return null;
  }
}

export function clearExamDraft(examId: string, studentId: string): void {
  localStorage.removeItem(keyFor(examId, studentId));
}

export function clearAllExamDrafts(): void {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith('exam-draft:v1:')) {localStorage.removeItem(key);}
  }
}
