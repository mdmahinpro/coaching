import { PortalNav } from './PortalNav';

interface Props { children: React.ReactNode }

export function PortalLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-navy-900">
      <PortalNav />
      <main className="pt-14 pb-20 md:pb-8 max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
