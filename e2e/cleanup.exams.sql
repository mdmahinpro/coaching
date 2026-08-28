DELETE FROM mcq_submissions WHERE student_id IN (SELECT id FROM students WHERE student_id LIKE '%E2E%' OR phone='01900000000');
DELETE FROM mcq_questions WHERE exam_id IN (SELECT id FROM exams WHERE title LIKE '__E2E%');
DELETE FROM exam_tokens   WHERE exam_id IN (SELECT id FROM exams WHERE title LIKE '__E2E%');
DELETE FROM exams WHERE title LIKE '__E2E%';
DELETE FROM students WHERE student_id LIKE '%E2E%' OR phone='01900000000';
DELETE FROM batches WHERE name LIKE '__E2E%';
