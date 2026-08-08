import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthErrorState } from './auth-error-state';
import { AuthLoadingState } from './auth-loading-state';

afterEach(cleanup);

describe('authentication states', () => {
  it('announces loading progress', () => {
    render(<AuthLoadingState label="Verifying credentials…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Verifying credentials…');
  });

  it('announces a safe error', () => {
    render(<AuthErrorState message="Email ou senha inválidos." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to complete authentication');
    expect(screen.getByRole('alert')).toHaveTextContent('Email ou senha inválidos.');
  });
});
