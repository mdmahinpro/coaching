import { useEffect } from 'react';
import { PortalNav } from './PortalNav';
import { fetchProfile } from '@/lib/portalApi';
import { useStudentStore } from '@/store/useStudentStore';

interface Props {
  children: React.ReactNode;
}

export function PortalLayout({ children }: Props) {
  const { student, setStudent } = useStudentStore();
  const studentId = student?.id;
  const studentToken = student?.token;

  // Refresh the student profile from the server on every portal page mount so
  // admin-side changes (batch assignment, class, photo) appear immediately
  // instead of lingering from a stale login-time session snapshot.
  useEffect(() => {
    if (!studentId || !studentToken) {
      return undefined;
    }
    let cancelled = false;
    fetchProfile()
      .then((profile: any) => {
        const currentStudent = useStudentStore.getState().student;
        if (
          !cancelled &&
          profile &&
          currentStudent?.id === studentId &&
          currentStudent.token === studentToken
        ) {
          setStudent({
            ...currentStudent,
            name: profile.name ?? currentStudent.name,
            student_id: profile.student_id ?? currentStudent.student_id,
            class_level: profile.class_level ?? currentStudent.class_level,
            batch_id: profile.batch_id ?? currentStudent.batch_id,
            batch_name: profile.batch_name ?? currentStudent.batch_name,
            photo_url: profile.photo_url ?? currentStudent.photo_url,
          });
        }
      })
      .catch(() => {
        /* stale/token-expired profile is non-fatal; keep cached snapshot */
      });
    return () => {
      cancelled = true;
    };
  }, [setStudent, studentId, studentToken]);

  return (
    <div className="min-h-screen bg-navy-900">
      <PortalNav />
      {/* pt satisfies the fixed top navbar (h-14); pb clears the fixed mobile
          bottom tab bar; explicit px give every portal page consistent,
          comfortable breathing room with no conflicting top/bottom utilities. */}
      <main className="max-w-5xl mx-auto pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-12 px-4 md:px-6 min-w-0 overflow-x-clip">{children}</main>
    </div>
  );
}
