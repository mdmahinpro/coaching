import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIntersection } from './useIntersection';

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

  intersect(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

let observers: MockIntersectionObserver[] = [];
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function DefaultTarget() {
  const { ref, isVisible } = useIntersection();
  return <section ref={ref} data-visible={isVisible} />;
}

function ConditionalTarget({ enabled }: { enabled: boolean }) {
  const { ref, isVisible } = useIntersection({ threshold: 0.3 }, enabled);
  return enabled ? <section ref={ref} data-visible={isVisible} /> : null;
}

async function renderConditional(enabled: boolean) {
  await act(async () => {
    root.render(<ConditionalTarget enabled={enabled} />);
  });
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('useIntersection', () => {
  it('preserves the default object-ref API and one-shot visibility for existing callers', async () => {
    await act(async () => {
      root.render(<DefaultTarget />);
    });
    const target = container.querySelector('section')!;
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(target);
    expect(observers[0].options.threshold).toBe(0.1);
    expect(target.dataset.visible).toBe('false');

    await act(async () => {
      observers[0].intersect(false);
    });
    expect(target.dataset.visible).toBe('false');
    expect(observers[0].disconnect).not.toHaveBeenCalled();

    await act(async () => {
      observers[0].intersect(true);
    });
    expect(target.dataset.visible).toBe('true');
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(observers).toHaveLength(1);
  });

  it('observes a conditionally mounted target when enabled becomes true', async () => {
    await renderConditional(false);
    expect(container.querySelector('section')).toBeNull();
    expect(observers).toHaveLength(0);

    await renderConditional(true);
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(container.querySelector('section'));
    expect(observers[0].options.threshold).toBe(0.3);

    await act(async () => {
      observers[0].intersect(true);
    });
    expect(container.querySelector('section')!.dataset.visible).toBe('true');
  });

  it('cleans up a hidden target and observes its replacement before the first intersection', async () => {
    await renderConditional(true);
    const firstTarget = container.querySelector('section');
    const firstObserver = observers[0];

    await renderConditional(false);
    expect(firstObserver.disconnect).toHaveBeenCalled();
    await renderConditional(true);
    const newTarget = container.querySelector('section');
    expect(newTarget).not.toBe(firstTarget);
    expect(observers).toHaveLength(2);
    expect(observers[1].observe).toHaveBeenCalledWith(newTarget);

    await act(async () => {
      root.render(null);
    });
    expect(observers[1].disconnect).toHaveBeenCalled();
  });

  it('keeps visibility sticky after the target has already intersected', async () => {
    await renderConditional(true);
    await act(async () => {
      observers[0].intersect(true);
    });
    await renderConditional(false);
    await renderConditional(true);

    expect(container.querySelector('section')!.dataset.visible).toBe('true');
    expect(observers).toHaveLength(1);
  });
});
