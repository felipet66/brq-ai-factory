import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ErrorState } from './error-state';
import { LoadingState } from './loading-state';

afterEach(cleanup);

describe('execution states', () => {
  it('announces loading without exposing internal details', () => {
    render(<LoadingState />);

    expect(screen.getByRole('status')).toHaveTextContent('Executing workflow');
    expect(screen.getByText(/Product Owner, Developer and QA/)).toBeInTheDocument();
  });

  it('announces escaped error text', () => {
    const { container } = render(
      <ErrorState message={'Unavailable <img src=x onerror=alert(1)>'} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Unavailable <img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });
});
