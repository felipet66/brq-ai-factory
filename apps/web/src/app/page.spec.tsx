import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HomePage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

describe('HomePage', () => {
  it('identifies the platform and exposes the execution form', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'BRQ AI Factory' })).toBeInTheDocument();
    expect(screen.getByText(/deterministic workflow/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Project Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Objective')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeInTheDocument();
  });
});
