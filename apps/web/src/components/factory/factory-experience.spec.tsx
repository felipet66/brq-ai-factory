import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFactoryViewModel } from './factory-view-model';
import {
  factoryExecutionFixture,
  factoryTimelineFixture,
} from './factory-view-model.spec.fixtures';
import { FactoryExperience } from './factory-experience';
import { useFactoryLiveData } from './use-factory-live-data';

vi.mock('./use-factory-live-data', () => ({ useFactoryLiveData: vi.fn() }));
vi.mock('./factory-workspace', () => ({
  FactoryWorkspace: ({ model }: { readonly model: ReturnType<typeof createFactoryViewModel> }) => (
    <section aria-label="factory workspace">{model.execution.projectName}</section>
  ),
}));

const useFactoryLiveDataMock = vi.mocked(useFactoryLiveData);

beforeEach(() => useFactoryLiveDataMock.mockReset());
afterEach(cleanup);

describe('FactoryExperience', () => {
  it('renders the dedicated Control Room loading state', () => {
    useFactoryLiveDataMock.mockReturnValue({ state: { status: 'loading' }, reload: vi.fn() });
    render(<FactoryExperience executionId="execution-001" canAccessPlayground={false} />);

    expect(screen.getByRole('heading', { level: 1, name: /AI Software Factory/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Loading factory state' })).toBeVisible();
  });

  it('renders a safe error and delegates explicit reload', () => {
    const reload = vi.fn();
    useFactoryLiveDataMock.mockReturnValue({
      state: { status: 'error', message: 'Factory data is unavailable.' },
      reload,
    });
    render(<FactoryExperience executionId="execution-001" canAccessPlayground={false} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Factory data is unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload factory state' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('passes only the FactoryViewModel to the presentation workspace', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });
    useFactoryLiveDataMock.mockReturnValue({
      state: { status: 'ready', model, updateError: null },
      reload: vi.fn(),
    });
    render(<FactoryExperience executionId={model.execution.executionId} canAccessPlayground />);

    expect(screen.getByRole('region', { name: 'factory workspace' })).toHaveTextContent(
      model.execution.projectName,
    );
  });
});
