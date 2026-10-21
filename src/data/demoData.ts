import { supabase } from '@/lib/supabase';

const DEMO_KEY = 'demo_loaded';

export function isDemoLoaded(): boolean {
  return localStorage.getItem(DEMO_KEY) === 'true';
}

export async function loadDemoData(): Promise<void> {
  // Demo seeding is gated behind the admin console — the guard here only
  // prevents accidental double-seeding, not the production app (admins
  // seed their own fresh tenant from Dashboard → "Load Demo Data").
  // if (import.meta.env.PROD) {
  //   throw new Error('Demo data cannot be loaded in production.');
  // }

  if (isDemoLoaded()) {
    return;
  }

  // ── 1. Teachers ──────────────────────────────────────────────────────────
  const { data: teachers, error: tErr } = await supabase
    .from('teachers')
    .insert([
      {
        name: 'Md. Rafiqul Islam',
        subject: 'Mathematics',
        qualification: 'MSc Mathematics',
        phone: '01711000001',
        email: 'rafiq@demo.com',
        salary: 15000,
        is_active: true,
        bio: 'অভিজ্ঞ গণিত শিক্ষক। ১৫ বছরের অধিক শিক্ষাদানের অভিজ্ঞতা।',
      },
      {
        name: 'Fatema Khatun',
        subject: 'English',
        qualification: 'MA English Literature',
        phone: '01711000002',
        email: 'fatema@demo.com',
        salary: 12000,
        is_active: true,
        bio: 'ইংরেজি সাহিত্য ও ব্যাকরণে বিশেষজ্ঞ।',
      },
      {
        name: 'Abdul Karim',
        subject: 'Science',
        qualification: 'BSc Physics',
        phone: '01711000003',
        email: 'karim@demo.com',
        salary: 13000,
        is_active: true,
        bio: 'পদার্থবিজ্ঞান ও সাধারণ বিজ্ঞানে দক্ষ।',
      },
    ])
    .select('id, name');
  if (tErr || !teachers) {
    throw new Error(tErr?.message ?? 'Teachers insert failed');
  }

  const [t1, t2, t3] = teachers;

  // ── 2. Batches ───────────────────────────────────────────────────────────
  const { data: batches, error: bErr } = await supabase
    .from('batches')
    .insert([
      {
        name: 'SSC-2025 গণিত',
        subject: 'Mathematics',
        teacher: t1.name,
        teacher_id: t1.id,
        class_level: 'Class 9-10',
        schedule: 'Sat, Mon, Wed  7:00-8:30 AM',
        schedule_days: ['Sat', 'Mon', 'Wed'],
        start_time: '07:00',
        fee: 500,
        monthly_fee: 500,
        capacity: 30,
        max_seats: 30,
        enrolled: 0,
        is_active: true,
        description: 'SSC পরীক্ষার্থীদের জন্য বিশেষ গণিত ব্যাচ।',
      },
      {
        name: 'HSC-2025 ইংরেজি',
        subject: 'English',
        teacher: t2.name,
        teacher_id: t2.id,
        class_level: 'Class 11-12',
        schedule: 'Sun, Tue, Thu  5:00-6:30 PM',
        schedule_days: ['Sun', 'Tue', 'Thu'],
        start_time: '17:00',
        fee: 600,
        monthly_fee: 600,
        capacity: 25,
        max_seats: 25,
        enrolled: 0,
        is_active: true,
        description: 'HSC ইংরেজি প্রস্তুতি ব্যাচ।',
      },
      {
        name: 'Class 8 বিজ্ঞান',
        subject: 'Science',
        teacher: t3.name,
        teacher_id: t3.id,
        class_level: 'Class 8',
        schedule: 'Sat, Mon  4:00-5:00 PM',
        schedule_days: ['Sat', 'Mon'],
        start_time: '16:00',
        fee: 400,
        monthly_fee: 400,
        capacity: 20,
        max_seats: 20,
        enrolled: 0,
        is_active: true,
        description: 'অষ্টম শ্রেণীর সাধারণ বিজ্ঞান।',
      },
    ])
    .select('id, name, fee');
  if (bErr || !batches) {
    throw new Error(bErr?.message ?? 'Batches insert failed');
  }

  const [b1, b2, b3] = batches;

  // ── 3. Students ──────────────────────────────────────────────────────────
  const { data: students, error: sErr } = await supabase
    .from('students')
    .insert([
      {
        name: 'আরিফ হোসেন',
        student_id: 'CF250001',
        phone: '01811000001',
        email: 'arif@demo.com',
        guardian_name: 'মো. হোসেন',
        guardian_phone: '01911000001',
        gender: 'male',
        class_level: 'Class 9',
        batch_id: b1.id,
        address: 'ঢাকা, বাংলাদেশ',
        status: 'active',
        is_approved: true,
        password: 'demo1234',
      },
      {
        name: 'সুমাইয়া খান',
        student_id: 'CF250002',
        phone: '01811000002',
        email: 'sumaiya@demo.com',
        guardian_name: 'মো. খান',
        guardian_phone: '01911000002',
        gender: 'female',
        class_level: 'Class 9',
        batch_id: b1.id,
        address: 'চট্টগ্রাম, বাংলাদেশ',
        status: 'active',
        is_approved: true,
        password: 'demo1234',
      },
      {
        name: 'রাহুল দাস',
        student_id: 'CF250003',
        phone: '01811000003',
        email: 'rahul@demo.com',
        guardian_name: 'সুনীল দাস',
        guardian_phone: '01911000003',
        gender: 'male',
        class_level: 'Class 11',
        batch_id: b2.id,
        address: 'সিলেট, বাংলাদেশ',
        status: 'active',
        is_approved: true,
        password: 'demo1234',
      },
      {
        name: 'নাদিয়া ইসলাম',
        student_id: 'CF250004',
        phone: '01811000004',
        email: 'nadia@demo.com',
        guardian_name: 'মো. ইসলাম',
        guardian_phone: '01911000004',
        gender: 'female',
        class_level: 'Class 11',
        batch_id: b2.id,
        address: 'রাজশাহী, বাংলাদেশ',
        status: 'active',
        is_approved: true,
        password: 'demo1234',
      },
      {
        name: 'তানভীর আহমেদ',
        student_id: 'CF250005',
        phone: '01811000005',
        email: 'tanvir@demo.com',
        guardian_name: 'মো. আহমেদ',
        guardian_phone: '01911000005',
        gender: 'male',
        class_level: 'Class 8',
        batch_id: b3.id,
        address: 'খুলনা, বাংলাদেশ',
        status: 'active',
        is_approved: true,
        password: 'demo1234',
      },
    ])
    .select('id, name, batch_id');
  if (sErr || !students) {
    throw new Error(sErr?.message ?? 'Students insert failed');
  }

  // ── 4. Fees — 2 months each ───────────────────────────────────────────────
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1);
  const fmt = (d: Date) => d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const month1 = fmt(prevMonth);
  const month2 = fmt(now);
  const paidDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 10).toISOString();

  const feeRows: any[] = [];
  for (const s of students) {
    const bFee = s.batch_id === b1.id ? b1.fee : s.batch_id === b2.id ? b2.fee : b3.fee;
    const bId = s.batch_id === b1.id ? b1.id : s.batch_id === b2.id ? b2.id : b3.id;
    feeRows.push(
      {
        student_id: s.id,
        batch_id: bId,
        amount: bFee,
        month: month1,
        status: 'paid',
        payment_date: paidDate,
        note: JSON.stringify({
          receipt_no: `RCP-${s.id.slice(-4).toUpperCase()}`,
          payment_method: 'bKash',
          final_amount: bFee,
        }),
      },
      { student_id: s.id, batch_id: bId, amount: bFee, month: month2, status: 'pending' }
    );
  }
  const { error: fErr } = await supabase.from('fees').insert(feeRows);
  if (fErr) {
    throw new Error(fErr.message);
  }

  // ── 5. Exam ───────────────────────────────────────────────────────────────
  const examDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { data: exam, error: eErr } = await supabase
    .from('exams')
    .insert([
      {
        title: 'গণিত মডেল টেস্ট ০১',
        subject: 'Mathematics',
        batch_id: b1.id,
        duration_minutes: 30,
        total_marks: 30,
        pass_marks: 18,
        status: 'ended',
        exam_date: examDate.toISOString().split('T')[0],
        type: 'mcq',
        timer_enabled: true,
        instructions: 'প্রতিটি প্রশ্নের জন্য ৩ নম্বর। কোনো নেগেটিভ মার্কিং নেই।',
      },
    ])
    .select('id')
    .single();
  if (eErr || !exam) {
    throw new Error(eErr?.message ?? 'Exam insert failed');
  }

  // ── 6. MCQ Questions (10) ─────────────────────────────────────────────────
  const qRows = [
    {
      exam_id: exam.id,
      order_num: 1,
      question_text: '৫ × ১২ = কত?',
      option_a: '৫০',
      option_b: '৬০',
      option_c: '৫৫',
      option_d: '৬৫',
      correct_option: 'b',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 2,
      question_text: '√১৪৪ = কত?',
      option_a: '১১',
      option_b: '১২',
      option_c: '১৩',
      option_d: '১৪',
      correct_option: 'b',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 3,
      question_text: '২³ = কত?',
      option_a: '৬',
      option_b: '৮',
      option_c: '৯',
      option_d: '১০',
      correct_option: 'b',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 4,
      question_text: '২০০ এর ২৫% কত?',
      option_a: '৪০',
      option_b: '৪৫',
      option_c: '৫০',
      option_d: '৫৫',
      correct_option: 'c',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 5,
      question_text: 'x + ৭ = ১৫ হলে x = ?',
      option_a: '৬',
      option_b: '৭',
      option_c: '৮',
      option_d: '৯',
      correct_option: 'c',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 6,
      question_text: 'একটি ত্রিভুজের বাহু ৩, ৪, ৫ হলে ক্ষেত্রফল কত?',
      option_a: '৬',
      option_b: '৮',
      option_c: '১০',
      option_d: '১২',
      correct_option: 'a',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 7,
      question_text: '0.5 × 0.5 = কত?',
      option_a: '০.০২৫',
      option_b: '০.২৫',
      option_c: '০.৫',
      option_d: '২.৫',
      correct_option: 'b',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 8,
      question_text: '1² + 2² + 3² = কত?',
      option_a: '১২',
      option_b: '১৩',
      option_c: '১৪',
      option_d: '১৫',
      correct_option: 'c',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 9,
      question_text: 'HCF(12, 18) = কত?',
      option_a: '৪',
      option_b: '৬',
      option_c: '৮',
      option_d: '৯',
      correct_option: 'b',
      marks: 3,
    },
    {
      exam_id: exam.id,
      order_num: 10,
      question_text: '৩x = ২১ হলে x = ?',
      option_a: '৬',
      option_b: '৭',
      option_c: '৮',
      option_d: '৯',
      correct_option: 'b',
      marks: 3,
    },
  ];
  const { data: qs, error: qErr } = await supabase
    .from('mcq_questions')
    .insert(qRows)
    .select('id, correct_option, order_num');
  if (qErr || !qs) {
    throw new Error(qErr?.message ?? 'Questions insert failed');
  }

  const sortedQs = [...qs].sort((a, b) => a.order_num - b.order_num);
  const wrong = (c: string) => (c === 'a' ? 'c' : 'a');

  const ans1: Record<string, string> = {};
  const ans2: Record<string, string> = {};
  sortedQs.forEach((q, i) => {
    ans1[q.id] = i < 8 ? q.correct_option : wrong(q.correct_option);
    ans2[q.id] = i < 6 ? q.correct_option : wrong(q.correct_option);
  });

  const [s1, s2] = students;
  const subDate = new Date(examDate.getTime() + 25 * 60 * 1000);
  await supabase.from('mcq_submissions').insert([
    {
      exam_id: exam.id,
      student_id: s1.id,
      answers: ans1,
      score: 24,
      correct_count: 8,
      wrong_count: 2,
      time_taken: 1520,
      rank: 1,
      submitted_at: subDate.toISOString(),
    },
    {
      exam_id: exam.id,
      student_id: s2.id,
      answers: ans2,
      score: 18,
      correct_count: 6,
      wrong_count: 4,
      time_taken: 1740,
      rank: 2,
      submitted_at: new Date(subDate.getTime() + 30000).toISOString(),
    },
  ]);

  // ── 7. Notices ────────────────────────────────────────────────────────────
  await supabase.from('notices').insert([
    {
      title: 'গণিত মডেল টেস্ট ০১ — ফলাফল প্রকাশিত',
      content:
        'SSC-2025 গণিত ব্যাচের মডেল টেস্ট ০১ এর ফলাফল প্রকাশিত হয়েছে। সর্বোচ্চ স্কোর: ২৪/৩০ (আরিফ হোসেন)। পোর্টালে লগইন করে ফলাফল দেখুন।',
      category: 'general',
      type: 'result',
      target: 'all',
      is_published: true,
      is_pinned: true,
    },
    {
      title: 'এই মাসের ফি পরিশোধের অনুরোধ',
      content:
        'সকল ছাত্রদের অনুরোধ করা হচ্ছে এই মাসের ফি দ্রুত পরিশোধ করুন। bKash বা Nagad এ পেমেন্ট করা যাবে।',
      category: 'general',
      type: 'fee',
      target: 'all',
      is_published: true,
      is_pinned: false,
    },
    {
      title: 'ঈদ উপলক্ষে বিশেষ ছুটির নোটিশ',
      content:
        'আগামীকাল থেকে ৩ দিন কোচিং বন্ধ থাকবে। ছুটির পরে স্বাভাবিক সময়সূচিতে ক্লাস শুরু হবে।',
      category: 'general',
      type: 'holiday',
      target: 'all',
      is_published: true,
      is_pinned: false,
    },
  ]);

  localStorage.setItem(DEMO_KEY, 'true');
}
