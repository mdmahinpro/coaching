/**
 * Exam answer-breakdown resolver — turns a question row + the student's
 * answers map into a structured, human-readable summary for the result views
 * (admin + portal + post-submit). The whole point: never show a bare option
 * letter ("Selected: b") — always surface the option TEXT so someone
 * revisiting the result can understand what the answer was and why it's right.
 */

export interface ReviewQuestion {
  id: string;
  question_text: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_option?: string;
  marks?: number;
  explanation?: string;
}

export interface ResolvedAnswer {
  questionId: string;
  questionText: string;
  marks: number;
  /** Letter the student picked (uppercase) or null when unanswered. */
  selectedLetter: string | null;
  /** The text of the student's chosen option (null when unanswered). */
  selectedText: string | null;
  /** Uppercase correct letter (always present for a DB-backed question). */
  correctLetter: string;
  /** The text of the correct option (null only if the option text is missing). */
  correctText: string | null;
  isRight: boolean;
  unanswered: boolean;
  explanation?: string;
}

/** option_a → base key; returns undefined for unknown. */
function optionKeyFor(letter: string): 'option_a' | 'option_b' | 'option_c' | 'option_d' | undefined {
  const l = letter.toUpperCase();
  return l === 'A' ? 'option_a' : l === 'B' ? 'option_b' : l === 'C' ? 'option_c' : l === 'D' ? 'option_d' : undefined;
}

/**
 * Resolve one question's result. `answers` may be keyed by question id
 * (preferred) or by the question's 0-based index (legacy payloads).
 */
export function resolveAnswer(
  q: ReviewQuestion,
  answers: Record<string, string>,
  index: number
): ResolvedAnswer {
  const correctLetter = (q.correct_option ?? '').toUpperCase();
  const rawSelected = answers[q.id] ?? answers[String(index)] ?? null;
  const selectedLetter = rawSelected ? String(rawSelected).toUpperCase() : null;

  const textOf = (letter: string | null): string | null => {
    if (!letter) {
      return null;
    }
    const key = optionKeyFor(letter);
    if (!key) {
      return null;
    }
    const v = q[key];
    return typeof v === 'string' ? v : null;
  };

  const isRight = !!selectedLetter && selectedLetter === correctLetter;

  return {
    questionId: q.id,
    questionText: q.question_text,
    marks: q.marks ?? 0,
    selectedLetter,
    selectedText: textOf(selectedLetter),
    correctLetter,
    correctText: textOf(correctLetter),
    isRight,
    unanswered: !selectedLetter,
    explanation: q.explanation ?? undefined,
  };
}

/**
 * Resolve every question in one pass.
 */
export function resolveAll(
  questions: ReviewQuestion[],
  answers: Record<string, string>
): ResolvedAnswer[] {
  return questions.map((q, i) => resolveAnswer(q, answers, i));
}