import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecutionForm } from './execution-form';

afterEach(cleanup);

describe('ExecutionForm', () => {
  it('exposes accessible fields with the public limits', () => {
    render(<ExecutionForm loading={false} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Delivery Mode')).toHaveValue('GREENFIELD');
    expect(screen.getByLabelText('Delivery Mode')).toHaveAccessibleDescription(
      'Select whether the workflow creates a new project or changes an existing one.',
    );
    expect(screen.getByLabelText('Project Name')).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText('Objective')).toHaveAttribute('maxlength', '16000');
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeEnabled();
  });

  it('normalizes valid values before submission', () => {
    const onSubmit = vi.fn();
    render(<ExecutionForm loading={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Project Name'), {
      target: { value: '  Customer Portal  ' },
    });
    fireEvent.change(screen.getByLabelText('Objective'), {
      target: { value: '  Let customers track their orders.  ' },
    });
    fireEvent.change(screen.getByLabelText('Delivery Mode'), {
      target: { value: 'CHANGE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Execute Workflow' }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      deliveryMode: 'CHANGE',
      projectName: 'Customer Portal',
      objective: 'Let customers track their orders.',
    });
  });

  it('rejects fields containing only whitespace', () => {
    const onSubmit = vi.fn();
    render(<ExecutionForm loading={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: '\n  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Execute Workflow' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Project Name cannot contain only spaces.')).toBeInTheDocument();
    expect(screen.getByText('Objective cannot contain only spaces.')).toBeInTheDocument();
    expect(screen.getByLabelText('Project Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Objective')).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables every control while loading', () => {
    render(<ExecutionForm loading onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Delivery Mode')).toBeDisabled();
    expect(screen.getByLabelText('Project Name')).toBeDisabled();
    expect(screen.getByLabelText('Objective')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeDisabled();
  });
});
