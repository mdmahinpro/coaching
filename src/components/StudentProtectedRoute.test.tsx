import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useStudentStore } from '@/store/useStudentStore';
import { StudentProtectedRoute } from './StudentProtectedRoute';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

vi.mock('@/utils/errorHandler', () => ({
  handleSupabaseError: vi.fn(),
}));

vi.mock('@/utils/sanitize', () => ({
  sanitize: (val: string) => val,
}));

vi.mock('@/lib/examRecovery', () => ({
  clearAllExamDrafts: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StudentSession = NonNullable<ReturnType<typeof useStudentStore.getState>['student']>;

const makeSession = (overrides: Partial<StudentSession> = {}): StudentSession => ({
  id: 'stu-1',
  name: 'Test Student',
  student_id: 'STU001',
  phone: '01700000000',
  status: 'active',
  is_approved: true,
  token: 'token-1',
  ...overrides,
});

const validRow = {
  id: 'stu-1',
  name: 'Updated Name',
  student_id: 'STU001',
  phone: '01700000000',
  email: 'a@b.com',
  class_level: 'HSC',
  batch_id: 'batch-1',
  photo_url: null,
  status: 'active',
  is_approved: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () =>
  act(async () => {
    await new Promise((res) => setTimeout(res, 0));
  });

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

async function renderAt(initialPath: string) {
  const router = createMemoryRouter(
    [
      { path: '/portal/login', element: <div>login-screen</div> },
      {
        path: '/protected',
        element: <StudentProtectedRoute />,
        children: [{ index: true, element: <div>protected-content</div> }],
      },
    ],
    { initialEntries: [initialPath] }
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RouterProvider router={router} />);
  });
  return { router };
}

describe('StudentProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useStudentStore.setState({
      student: null,
      sessionChecking: false,
      sessionValid: false,
      sessionError: false,
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  it('redirects to login when there is no student session', async () => {
    const { router } = await renderAt('/protected');
    await flush();

    expect(container!.textContent).toContain('login-screen');
    expect(container!.textContent).not.toContain('protected-content');
    expect(router.state.location.pathname).toBe('/portal/login');
  });

  it('shows loading and withholds protected content while validation is unresolved', async () => {
    const { supabase } = await import('@/lib/supabase');
    useStudentStore.setState({ student: makeSession() });
    const pending = deferred<{ data: unknown; error: unknown }>();
    vi.mocked(supabase.rpc).mockReturnValue(pending.promise as any);

    await renderAt('/protected');
    await flush();

    expect(container!.querySelector('.animate-spin')).not.toBeNull();
    expect(container!.textContent).not.toContain('protected-content');
    expect(container!.textContent).not.toContain('login-screen');
    expect(useStudentStore.getState().sessionValid).toBe(false);
  });

  it('renders the protected Outlet after a valid server validation', async () => {
    const { supabase } = await import('@/lib/supabase');
    useStudentStore.setState({ student: makeSession() });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [validRow], error: null } as any);

    await renderAt('/protected');
    await flush();

    expect(container!.textContent).toContain('protected-content');
    expect(useStudentStore.getState().sessionValid).toBe(true);
  });

  it('shows retry on a transient failure and renders the Outlet after a successful retry', async () => {
    const { supabase } = await import('@/lib/supabase');
    useStudentStore.setState({ student: makeSession() });
    vi.mocked(supabase.rpc)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: [validRow], error: null } as any);

    await renderAt('/protected');
    await flush();

    const retryButton = container!.querySelector('button');
    expect(retryButton).not.toBeNull();
    expect(container!.textContent).toContain('Could not verify your session.');
    expect(container!.textContent).not.toContain('protected-content');

    await act(async () => {
      retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 0));
    });

    expect(container!.textContent).toContain('protected-content');
    expect(container!.textContent).not.toContain('Could not verify your session.');
    expect(useStudentStore.getState().sessionValid).toBe(true);
  });

  it('redirects to login when validation confirms the session is invalid', async () => {
    const { supabase } = await import('@/lib/supabase');
    useStudentStore.setState({ student: makeSession() });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as any);

    const { router } = await renderAt('/protected');
    await flush();

    expect(useStudentStore.getState().student).toBeNull();
    expect(container!.textContent).not.toContain('protected-content');
    expect(router.state.location.pathname).toBe('/portal/login');
  });
});
