import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroSection } from './HeroSection';
import { defaults, useSettingsStore } from '@/store/useSettingsStore';

const db = vi.hoisted(() => ({
  from: vi.fn(),
  teachers: { select: vi.fn(), eq: vi.fn() },
  batches: { select: vi.fn(), eq: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: db.from },
}));

vi.mock('@/components/shared/Logo', () => ({
  Logo: () => <span>logo</span>,
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();

  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    observers.push(this);
  }

  intersect() {
    const target = this.observe.mock.calls[0]?.[0] as Element;
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

let observers: MockIntersectionObserver[] = [];
let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;
const fetchMock = vi.fn();

function mockAggregate(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });
}

function countResponse(count?: unknown) {
  return { data: null, error: null, ...(count === undefined ? {} : { count }) };
}

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<HeroSection />);
  });
}

async function revealStats() {
  expect(observers).toHaveLength(1);
  expect(observers[0].observe).toHaveBeenCalledWith(container!.querySelector('.grid-cols-4'));
  await act(async () => {
    observers[0].intersect();
  });
  await finishCounting();
}

async function finishCounting() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

function displayedStats() {
  return ['শিক্ষার্থী', 'কোর্স', 'শিক্ষক', 'সাফল্য'].map((label) => {
    const labelElement = Array.from(container!.querySelectorAll('div')).find(
      (element) => element.textContent === label
    );
    expect(labelElement, `Missing stat label: ${label}`).toBeDefined();
    return labelElement!.previousElementSibling!.textContent;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  observers = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  // Both network boundaries are mocked. No real Supabase client is imported.
  vi.stubGlobal('fetch', fetchMock);
  mockAggregate({ students: 18 });
  db.teachers.select.mockReturnValue({ eq: db.teachers.eq });
  db.batches.select.mockReturnValue({ eq: db.batches.eq });
  // select(..., { head: true }).eq(...) resolves directly to a count response;
  // there is no trailing .head() method in the production query chain.
  db.teachers.eq.mockResolvedValue(countResponse(7));
  db.batches.eq.mockResolvedValue(countResponse(3));
  db.from.mockImplementation((table: string) => {
    if (table === 'teachers' || table === 'batches') {
      return db[table];
    }
    throw new Error(`Unexpected Supabase table: ${table}`);
  });
  useSettingsStore.setState({
    settings: {
      ...defaults,
      statAutoFromDb: true,
      showHomeStats: true,
      statStudents: 444,
      statTeachers: 22,
      statBatches: 11,
      statSuccessRate: 87,
    },
    dbLoaded: false,
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('HeroSection homepage with secured stats', () => {
  it('preserves configured success rate when the stats aggregate fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 });

    await render();
    await revealStats();

    expect(container!.querySelector('h1')).not.toBeNull();
    expect(container!.querySelectorAll('a')).toHaveLength(2);
    expect(displayedStats()).toEqual(['—', '—', '—', '87%']);
    expect(fetchMock).toHaveBeenCalledWith('/api/home-stats');
  });

  it('keeps pending DB counts unavailable without masking configured success rate', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    await render();
    await revealStats();

    expect(displayedStats()).toEqual(['—', '—', '—', '87%']);
  });

  it.each(['network failure', 'invalid JSON'])('handles aggregate %s', async (failure) => {
    if (failure === 'network failure') {
      fetchMock.mockRejectedValue(new Error('Offline'));
    } else {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => { throw new SyntaxError('Invalid JSON'); },
      });
    }

    await render();
    await revealStats();

    expect(displayedStats()).toEqual(['—', '—', '—', '87%']);
  });

  describe.each(['students', 'teachers', 'batches'] as const)('%s count validation', (source) => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['fractional', 1.5],
      ['negative', -1],
      ['numeric string', '0'],
      ['NaN', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
    ])('treats a %s count as unavailable, never as zero', async (_name, count) => {
      if (source === 'students') {
        mockAggregate(count === undefined ? {} : { students: count });
      } else {
        db[source].eq.mockResolvedValue(countResponse(count));
      }

      await render();
      await revealStats();

      expect(displayedStats()).toEqual(['—', '—', '—', '87%']);
    });
  });

  it.each(['teachers', 'batches'] as const)('handles a %s query error', async (source) => {
    db[source].eq.mockResolvedValue({ data: null, count: 0, error: { message: 'Query failed' } });

    await render();
    await revealStats();

    expect(displayedStats()).toEqual(['—', '—', '—', '87%']);
  });

  it.each(['teachers', 'batches'] as const)('handles a rejected %s query', async (source) => {
    db[source].eq.mockRejectedValue(new Error('Offline'));

    await render();
    await revealStats();

    expect(displayedStats()).toEqual(['—', '—', '—', '87%']);
  });

  it('renders honest zero counts from all three successful sources', async () => {
    mockAggregate({ students: 0 });
    db.teachers.eq.mockResolvedValue(countResponse(0));
    db.batches.eq.mockResolvedValue(countResponse(0));

    await render();
    await revealStats();

    expect(displayedStats()).toEqual(['0+', '0+', '0+', '87%']);
  });

  it('keeps the secured student aggregate and active teacher/batch definitions', async () => {
    await render();
    await revealStats();

    expect(displayedStats()).toEqual(['18+', '3+', '7+', '87%']);
    expect(fetchMock.mock.calls).toEqual([['/api/home-stats']]);
    expect(db.from.mock.calls).toEqual([['teachers'], ['batches']]);
    for (const query of [db.teachers, db.batches]) {
      expect(query.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
      expect(query.eq).toHaveBeenCalledWith('is_active', true);
    }
  });

  it('observes the stats node when hidden settings hydrate to visible', async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, showHomeStats: false },
    });
    await render();
    expect(container!.querySelector('.grid-cols-4')).toBeNull();
    expect(observers).toHaveLength(0);

    await act(async () => {
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, showHomeStats: true },
        dbLoaded: true,
      });
    });
    await revealStats();

    expect(observers[0].options.threshold).toBe(0.3);
    expect(displayedStats()).toEqual(['18+', '3+', '7+', '87%']);
  });

  it('uses configured counts in manual mode without requesting DB stats', async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, statAutoFromDb: false },
    });

    await render();
    await revealStats();

    expect(displayedStats()).toEqual(['444+', '11+', '22+', '87%']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('preserves a configured zero success rate during DB failure', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, statSuccessRate: 0 },
    });

    await render();
    await revealStats();

    expect(displayedStats()).toEqual(['—', '—', '—', '0%']);
  });

  it('recovers DB counts on a later poll without changing the configured success rate', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await render();
    await revealStats();
    expect(displayedStats()).toEqual(['—', '—', '—', '87%']);

    mockAggregate({ students: 18 });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await finishCounting();

    expect(displayedStats()).toEqual(['18+', '3+', '7+', '87%']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});