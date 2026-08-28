-- Wipe any prior __E2E__ seed, then recreate fresh, SELECT the new exam id.
DELETE FROM mcq_submissions WHERE student_id IN (SELECT id FROM students WHERE student_id LIKE '%E2E%' OR phone='01900000000');
DELETE FROM mcq_questions WHERE exam_id IN (SELECT id FROM exams WHERE title LIKE '__E2E%');
DELETE FROM exam_tokens   WHERE exam_id IN (SELECT id FROM exams WHERE title LIKE '__E2E%');
DELETE FROM exams WHERE title LIKE '__E2E%';
DELETE FROM students WHERE student_id LIKE '%E2E%' OR phone='01900000000';
DELETE FROM batches WHERE name LIKE '__E2E%';
DO $$
DECLARE v_b UUID; v_s UUID; v_e UUID;
BEGIN
  INSERT INTO batches (name, capacity, is_active) VALUES ('__E2E Batch__', 10, true) RETURNING id INTO v_b;
  INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
  VALUES ('E2E Student', '01900000000', '__E2E0001', crypt('E2ePass!2026', gen_salt('bf')), true, 'active', v_b)
  RETURNING id INTO v_s;
  INSERT INTO exams (title, subject, status, exam_date, duration_minutes, total_marks, pass_marks,
                     instructions, start_time, end_time, timer_enabled, strict_mode, type, batch_id, batch_ids)
  VALUES ('__E2E Exam__', 'E2E Subject', 'active', CURRENT_DATE, 30, 3, 1,
          'E2E instructions', NOW() - interval '5 minutes', NOW() + interval '30 minutes',
          true, true, 'mcq', v_b, ARRAY[v_b])
  RETURNING id INTO v_e;
  INSERT INTO mcq_questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks, order_num) VALUES
  (v_e, 'E2E Q1: two plus two?', '3', '4', '5', '6', 'b', 1, 1),
  (v_e, 'E2E Q2: first letter?', 'A', 'B', 'C', 'D', 'a', 2, 2);
END $$;
SELECT id AS e2e_exam_id FROM exams WHERE title='__E2E Exam__';
