import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ErrorState } from './error-state';
import { LoadingState } from './loading-state';

afterEach(cleanup);

describe('execution states', () => {
  it('renders the queued state without exposing internal details', () => {
    render(<LoadingState job={null} />);

    expect(screen.getByRole('heading', { name: 'Workflow queued' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/waiting for the local execution worker/i)).toBeInTheDocument();
    expect(screen.getByText('Na fila')).toBeInTheDocument();
    expect(screen.getAllByText('Pendente')).toHaveLength(2);
  });

  it('announces escaped error text', () => {
    const { container } = render(
      <ErrorState message={'Unavailable <img src=x onerror=alert(1)>'} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Unavailable <img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });
});
