import { useState } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { cn } from '@/lib/utils';

interface Props {
  children: React.ReactNode;
  title: string;
}

export function AdminLayout({ children, title }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-navy-900 flex">
      <AdminSidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className={cn(
        'flex-1 flex flex-col min-w-0 transition-all duration-300',
        'ml-0 md:ml-64',
        collapsed && 'md:ml-16'
      )}>
        <AdminHeader
          title={title}
          onMenuToggle={() => setMobileOpen(true)}
        />
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
