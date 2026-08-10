import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PreviewExperience } from './preview-experience';

vi.mock('./preview-control', () => ({
  PreviewControl: ({ executionId }: { readonly executionId: string }) => (
    <section aria-label="preview control">{executionId}</section>
  ),
}));

describe('PreviewExperience', () => {
  it('keeps Preview visually separate from the Factory and links back to trusted views', () => {
    const executionId = `execution-${'1'.repeat(32)}`;
    render(<PreviewExperience executionId={executionId} />);
    expect(screen.getByRole('heading', { name: /Build Preview/ })).toBeVisible();
    expect(screen.getByText('Control plane / no deployment')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Factory View' })).toHaveAttribute(
      'href',
      `/executions/${executionId}/factory`,
    );
    expect(screen.getByRole('region', { name: 'preview control' })).toHaveTextContent(executionId);
  });
});
