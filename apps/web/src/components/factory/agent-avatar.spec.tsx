import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentAvatar } from './agent-avatar';
import type { AgentVisualPresentation } from './agent-visual-state';

afterEach(cleanup);

const PRESENTATION = Object.freeze({
  agentId: 'DEVELOPER',
  state: 'WORKING',
  assetPath: '/assets/developer/03-working.png',
  technicalStatus: 'WORKING',
  badgeLabel: 'WORKING',
  microcopy: 'Developer stage is preparing the technical specification.',
  motion: 'ACTIVE',
} satisfies AgentVisualPresentation);

describe('AgentAvatar', () => {
  it('renders a responsive next/image asset with decorative image content', () => {
    const { container } = render(<AgentAvatar agentName="Developer" presentation={PRESENTATION} />);

    const visual = screen.getByRole('img', { name: 'Developer visual state: WORKING' });
    const image = container.querySelector('img');

    expect(visual).toHaveAttribute('data-visual-state', 'WORKING');
    expect(visual).toHaveAttribute('data-motion', 'ACTIVE');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('aria-hidden', 'true');
    expect(image).toHaveAttribute('width', '1254');
    expect(image).toHaveAttribute('height', '1254');
    expect(image).toHaveAttribute(
      'sizes',
      '(max-width: 48rem) 72vw, (max-width: 72rem) 34vw, 20vw',
    );
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image?.getAttribute('src')).toContain('03-working.png');
  });

  it('loads the first Product Owner portrait eagerly for the Factory Floor LCP', () => {
    const productOwnerPresentation = Object.freeze({
      ...PRESENTATION,
      agentId: 'PRODUCT_OWNER',
      assetPath: '/assets/po/03-working.png',
    }) satisfies AgentVisualPresentation;

    const { container } = render(
      <AgentAvatar agentName="Product Owner" presentation={productOwnerPresentation} />,
    );

    expect(container.querySelector('img')).toHaveAttribute('loading', 'eager');
  });
});
