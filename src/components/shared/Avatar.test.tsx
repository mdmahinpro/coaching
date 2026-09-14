import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Avatar } from './Avatar';

const STUDENT_ID = '11111111-2222-3333-4444-555555555555';
const SIGNED_URL = 'https://signed.example/avatar';

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}));

vi.mock('@/lib/avatars', () => ({
  seededAvatarUrl: (seed: string) => `https://seeded.example/${encodeURIComponent(seed)}.svg`,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

async function render(element: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
  await act(async () => {
    await new Promise((res) => setTimeout(res, 0));
  });
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
  }
  if (container?.parentNode) {container.parentNode.removeChild(container);}
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('Avatar private-avatar display', () => {
  it('resolves a private reference through the signed retrieval endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ signedURL: SIGNED_URL }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await render(
      <Avatar
        name="Test Student"
        src={`avatars/students/${STUDENT_ID}-photo.jpg`}
        bearer="portal-token"
      />
    );

    expect(container!.querySelector('img')?.getAttribute('src')).toBe(SIGNED_URL);
    expect(fetchMock).toHaveBeenCalledWith('/api/retrieve-avatar', expect.any(Object));
  });

  it('renders an existing full public URL unchanged', async () => {
    const existing = 'https://randomuser.me/api/portraits/men/1.jpg';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await render(<Avatar name="Test Student" src={existing} bearer="portal-token" />);

    expect(container!.querySelector('img')?.getAttribute('src')).toBe(existing);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
