import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useStudentStore } from '@/store/useStudentStore';

type StudentSession = NonNullable<ReturnType<typeof useStudentStore.getState>['student']>;

vi.mock('@/components/portal/PortalLayout', () => ({
  PortalLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

vi.mock('@/lib/portalApi', () => ({
  updatePhoto: vi.fn(),
  changePassword: vi.fn(),
  updateEmail: vi.fn(),
  fetchProfile: vi.fn(),
}));

vi.mock('@/utils/errorHandler', () => ({
  handleSupabaseError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/env', () => ({
  env: { VITE_SUPABASE_URL: 'https://flbvusudwszxdylxevfe.supabase.co' },
}));

import PortalProfilePage from './PortalProfilePage';
import { updatePhoto } from '@/lib/portalApi';

const PROJECT = 'https://flbvusudwszxdylxevfe.supabase.co';
const STUDENT_ID = '11111111-2222-3333-4444-555555555555';
const PUBLIC_URL = `${PROJECT}/storage/v1/object/public/avatars/students/${STUDENT_ID}-photo.jpg`;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeSession = (overrides: Partial<StudentSession> = {}): StudentSession => ({
  id: STUDENT_ID,
  name: 'Test Student',
  student_id: 'STU001',
  phone: '01700000000',
  status: 'active',
  is_approved: true,
  token: 'portal-token',
  ...overrides,
});

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<PortalProfilePage />);
  });
  return container;
}

const flush = () =>
  act(async () => {
    await new Promise((res) => setTimeout(res, 0));
  });

async function chooseFile(file: File) {
  const input = container!.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useStudentStore.setState({
    student: makeSession(),
    sessionChecking: false,
    sessionValid: true,
    sessionError: false,
  });

  // Minimal image-compression fixtures for jsdom.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => {
    const fakeBlob = {
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Blob;
    cb(fakeBlob);
  });
  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 100;
    height = 100;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', MockImage as unknown as typeof Image);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
  }
  if (container?.parentNode) container.parentNode.removeChild(container);
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PortalProfilePage avatar upload', () => {
  it('saves payload.publicUrl via portal_update_photo and displays it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: `students/${STUDENT_ID}-photo.jpg`, publicUrl: PUBLIC_URL }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(updatePhoto).mockResolvedValue(undefined as never);

    await render();
    await chooseFile(new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/upload-avatar',
      expect.objectContaining({ method: 'POST' })
    );
    expect(updatePhoto).toHaveBeenCalledWith(PUBLIC_URL);
    expect(useStudentStore.getState().student?.photo_url).toBe(PUBLIC_URL);
    expect(container!.querySelector('img')?.getAttribute('src')).toBe(PUBLIC_URL);
  });

  it('displays the saved public URL after a reload (remount)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ publicUrl: PUBLIC_URL }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(updatePhoto).mockResolvedValue(undefined as never);

    await render();
    await chooseFile(new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }));
    await flush();

    // Simulate a reload: the persisted session carries the public URL.
    await act(async () => {
      root!.unmount();
    });
    container!.remove();
    root = null;
    container = null;

    await render();
    await flush();

    expect(container!.querySelector('img')?.getAttribute('src')).toBe(PUBLIC_URL);
  });

  it('keeps an existing full public URL displayed without any retrieval call', async () => {
    const existing = 'https://randomuser.me/api/portraits/men/1.jpg';
    useStudentStore.setState({ student: makeSession({ photo_url: existing }) });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await render();
    await flush();

    expect(container!.querySelector('img')?.getAttribute('src')).toBe(existing);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not replace the existing photo reference when the upload is rejected', async () => {
    const existing = 'https://randomuser.me/api/portraits/men/1.jpg';
    useStudentStore.setState({ student: makeSession({ photo_url: existing }) });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await render();
    await chooseFile(new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }));
    await flush();

    expect(updatePhoto).not.toHaveBeenCalled();
    expect(useStudentStore.getState().student?.photo_url).toBe(existing);
    expect(container!.querySelector('img')?.getAttribute('src')).toBe(existing);
  });

  it('does not replace the existing photo when portal_update_photo fails', async () => {
    const existing = 'https://randomuser.me/api/portraits/men/1.jpg';
    useStudentStore.setState({ student: makeSession({ photo_url: existing }) });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ publicUrl: PUBLIC_URL }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(updatePhoto).mockRejectedValue(new Error('Session expired'));

    await render();
    await chooseFile(new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }));
    await flush();

    expect(updatePhoto).toHaveBeenCalledWith(PUBLIC_URL);
    expect(useStudentStore.getState().student?.photo_url).toBe(existing);
  });

  it('does not update the photo when the session has no token (unauthenticated upload is rejected)', async () => {
    const existing = 'https://randomuser.me/api/portraits/men/1.jpg';
    useStudentStore.setState({ student: makeSession({ photo_url: existing, token: undefined }) });
    // Server rejects an unauthenticated/expired session with 401.
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await render();
    await chooseFile(new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/upload-avatar',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ' }),
      })
    );
    expect(updatePhoto).not.toHaveBeenCalled();
    expect(useStudentStore.getState().student?.photo_url).toBe(existing);
  });
});
