import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/pages/public/AdmissionPage', () => ({
  default: () => <div>admission-destination</div>,
}));

import { AppRoutes } from './App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe('public routes', () => {
  it('redirects the retired portal signup route to admission', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/portal/signup']}>
          <AppRoutes />
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain('admission-destination');
  });
});
