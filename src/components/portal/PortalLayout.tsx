import { useEffect } from 'react';
import { PortalNav } from './PortalNav';
import { fetchProfile } from '@/lib/portalApi';
import { useStudentStore } from '@/store/useStudentStore';

interface Props {
  children: React.ReactNode;
}

export function PortalLayout({ children }: Props) {
  const { student, setStudent } = useStudentStore();

  // Refresh the student profile from the server on every portal page mount so
  // admin-side changes (batch assignment, class, photo) appear immediately
  // instead of lingering from a stale login-time session snapshot.
  useEffect(() => {
    if (!student?.token) {
      return;
    }
    let cancelled = false;
    fetchProfile()
      .then((profile: any) => {
        if (!cancelled && profile) {
          setStudent({
            ...student,
            name: profile.name ?? student.name,
            student_id: profile.student_id ?? student.student_id,
            class_level: profile.class_level ?? student.class_level,
            batch_id: profile.batch_id ?? student.batch_id,
            batch_name: profile.batch_name ?? student.batch_name,
            photo_url: profile.photo_url ?? student.photo_url,
          });
        }
      })
      .catch(() => {
        /* stale/token-expired profile is non-fatal; keep cached snapshot */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, student?.token]);

  return (
    <div className="min-h-screen bg-navy-900">
      <PortalNav />
      {/* pt satisfies the fixed top navbar (h-14); pb clears the fixed mobile
          bottom tab bar; explicit px give every portal page consistent,
          comfortable breathing room with no conflicting top/bottom utilities. */}
      <main className="max-w-5xl mx-auto pt-20 pb-28 md:pb-12 px-4 md:px-6">{children}</main>
    </div>
  );
}
