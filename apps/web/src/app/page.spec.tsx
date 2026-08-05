import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('should identify the project and the current Sprint', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: 'BRQ AI Factory' })).toBeInTheDocument();
    expect(screen.getByText(/Sprint 0/i)).toBeInTheDocument();
  });
});
