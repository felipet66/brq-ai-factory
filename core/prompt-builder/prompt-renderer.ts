import type {
  PromptChannel,
  PromptRenderedOutput,
  ResolvedPromptBlock,
  ResolvedPromptDocument,
  ResolvedPromptFragment,
  ResolvedPromptSection,
} from './contracts';
import { deepFreeze } from './immutability';

function renderFragment(fragment: ResolvedPromptFragment): string {
  const boundary = `${fragment.id}:${fragment.hash}`;

  return [
    `<<<BEGIN_PROMPT_FRAGMENT:${boundary}>>>`,
    `id: ${fragment.id}`,
    `type: ${fragment.type}`,
    `sourceId: ${fragment.sourceId ?? 'STATIC'}`,
    `sourceItemId: ${fragment.sourceItemId ?? 'NONE'}`,
    `contentBytes: ${fragment.sizeBytes}`,
    `<<<BEGIN_PROMPT_FRAGMENT_CONTENT:${boundary}>>>`,
    fragment.content,
    `<<<END_PROMPT_FRAGMENT_CONTENT:${boundary}>>>`,
    `<<<END_PROMPT_FRAGMENT:${boundary}>>>`,
  ].join('\n');
}

function renderBlock(block: ResolvedPromptBlock): string {
  const boundary = `${block.id}:${block.hash}`;

  return [
    `<<<BEGIN_PROMPT_BLOCK:${boundary}>>>`,
    `id: ${block.id}`,
    `kind: ${block.kind}`,
    `contentBytes: ${block.sizeBytes}`,
    `fragmentCount: ${block.fragments.length}`,
    ...block.fragments.map(renderFragment),
    `<<<END_PROMPT_BLOCK:${boundary}>>>`,
  ].join('\n');
}

function renderSection(section: ResolvedPromptSection): string {
  const boundary = `${section.id}:${section.hash}`;

  return [
    `<<<BEGIN_PROMPT_SECTION:${boundary}>>>`,
    `id: ${section.id}`,
    `kind: ${section.kind}`,
    `channel: ${section.channel}`,
    `trust: ${section.trust}`,
    `contentBytes: ${section.sizeBytes}`,
    `blockCount: ${section.blocks.length}`,
    ...section.blocks.map(renderBlock),
    `<<<END_PROMPT_SECTION:${boundary}>>>`,
  ].join('\n');
}

function renderChannel(document: ResolvedPromptDocument, channel: PromptChannel): string {
  return document.sections
    .filter((section) => section.channel === channel)
    .map(renderSection)
    .join('\n');
}

export function renderPromptDocument(document: ResolvedPromptDocument): PromptRenderedOutput {
  return deepFreeze({
    instructions: renderChannel(document, 'INSTRUCTIONS'),
    input: renderChannel(document, 'INPUT'),
  });
}
