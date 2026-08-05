import type { PromptResult, ResolvedPromptDocument, ResolvedPromptSection } from './contracts';

interface ComparablePromptNode {
  readonly hash: string;
  readonly id: string;
}

export type PromptComparisonNodeType = 'BLOCK' | 'FRAGMENT' | 'SECTION';

interface PromptNodeNavigator<
  Root,
  Node extends ComparablePromptNode,
  NodeType extends PromptComparisonNodeType,
> {
  readonly nodeType: NodeType;
  getNodes(root: Root): readonly Node[];
  getPath(node: Node): readonly string[];
}

export interface PromptNodeReference {
  readonly hash: string;
  readonly id: string;
  readonly index: number;
  readonly nodeType: PromptComparisonNodeType;
  readonly path: readonly string[];
}

export interface ChangedPromptNode {
  readonly after: PromptNodeReference;
  readonly before: PromptNodeReference;
}

export interface ReorderedPromptNode {
  readonly afterIndex: number;
  readonly beforeIndex: number;
  readonly hash: string;
  readonly id: string;
  readonly nodeType: PromptComparisonNodeType;
  readonly path: readonly string[];
}

export interface PromptComparison {
  readonly added: readonly PromptNodeReference[];
  readonly changed: readonly ChangedPromptNode[];
  readonly equal: boolean;
  readonly promptHashChanged: boolean;
  readonly removed: readonly PromptNodeReference[];
  readonly reordered: readonly ReorderedPromptNode[];
}

interface ComparedNodes {
  readonly added: readonly PromptNodeReference[];
  readonly changed: readonly ChangedPromptNode[];
  readonly removed: readonly PromptNodeReference[];
  readonly reordered: readonly ReorderedPromptNode[];
}

const SECTION_NAVIGATOR: PromptNodeNavigator<
  ResolvedPromptDocument,
  ResolvedPromptSection,
  'SECTION'
> = {
  nodeType: 'SECTION',
  getNodes: (document) => document.sections,
  getPath: (section) => [section.id],
};

function freezeReference(reference: PromptNodeReference): PromptNodeReference {
  return Object.freeze(reference);
}

function asReference(
  node: ComparablePromptNode,
  index: number,
  nodeType: PromptNodeReference['nodeType'],
  path: readonly string[],
): PromptNodeReference {
  return freezeReference({
    hash: node.hash,
    id: node.id,
    index,
    nodeType,
    path: Object.freeze([...path]),
  });
}

interface IndexedPromptNode<Node extends ComparablePromptNode> {
  readonly index: number;
  readonly node: Node;
  readonly path: readonly string[];
}

function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function indexUniqueNodes<
  Root,
  Node extends ComparablePromptNode,
  NodeType extends PromptComparisonNodeType,
>(
  nodes: readonly Node[],
  navigator: PromptNodeNavigator<Root, Node, NodeType>,
): ReadonlyMap<string, IndexedPromptNode<Node>> {
  const indexed = new Map<string, IndexedPromptNode<Node>>();

  nodes.forEach((node, index) => {
    const path = Object.freeze([...navigator.getPath(node)]);
    const key = pathKey(path);

    if (indexed.has(key)) {
      throw new TypeError(
        `${navigator.nodeType} paths must be unique for deterministic comparison.`,
      );
    }

    indexed.set(key, { index, node, path });
  });

  return indexed;
}

function compareNodes<
  Root,
  Node extends ComparablePromptNode,
  NodeType extends PromptComparisonNodeType,
>(
  beforeRoot: Root,
  afterRoot: Root,
  navigator: PromptNodeNavigator<Root, Node, NodeType>,
): ComparedNodes {
  const beforeNodes = navigator.getNodes(beforeRoot);
  const afterNodes = navigator.getNodes(afterRoot);
  const beforeByPath = indexUniqueNodes(beforeNodes, navigator);
  const afterByPath = indexUniqueNodes(afterNodes, navigator);

  const removed = beforeNodes.flatMap((node, index) => {
    const path = navigator.getPath(node);
    return afterByPath.has(pathKey(path))
      ? []
      : [asReference(node, index, navigator.nodeType, path)];
  });
  const added = afterNodes.flatMap((node, index) => {
    const path = navigator.getPath(node);
    return beforeByPath.has(pathKey(path))
      ? []
      : [asReference(node, index, navigator.nodeType, path)];
  });

  const changed = afterNodes.flatMap((node, index) => {
    const path = navigator.getPath(node);
    const previous = beforeByPath.get(pathKey(path));

    if (previous === undefined || previous.node.hash === node.hash) {
      return [];
    }

    return [
      Object.freeze({
        before: asReference(previous.node, previous.index, navigator.nodeType, previous.path),
        after: asReference(node, index, navigator.nodeType, path),
      }),
    ];
  });

  const commonBeforePaths = beforeNodes
    .map((node) => pathKey(navigator.getPath(node)))
    .filter((key) => afterByPath.has(key));
  const commonAfterPaths = afterNodes
    .map((node) => pathKey(navigator.getPath(node)))
    .filter((key) => beforeByPath.has(key));
  const commonBeforePosition = new Map(commonBeforePaths.map((key, index) => [key, index]));

  const reordered = commonAfterPaths.flatMap((key, relativeAfterIndex) => {
    const relativeBeforeIndex = commonBeforePosition.get(key);
    const previous = beforeByPath.get(key);
    const current = afterByPath.get(key);

    if (
      relativeBeforeIndex === undefined ||
      previous === undefined ||
      current === undefined ||
      relativeBeforeIndex === relativeAfterIndex
    ) {
      return [];
    }

    return [
      Object.freeze({
        afterIndex: current.index,
        beforeIndex: previous.index,
        hash: current.node.hash,
        id: current.node.id,
        nodeType: navigator.nodeType,
        path: current.path,
      }),
    ];
  });

  return Object.freeze({
    added: Object.freeze(added),
    changed: Object.freeze(changed),
    removed: Object.freeze(removed),
    reordered: Object.freeze(reordered),
  });
}

export function comparePromptResults(before: PromptResult, after: PromptResult): PromptComparison {
  const sections = compareNodes(before.document, after.document, SECTION_NAVIGATOR);
  const promptHashChanged = before.metadata.promptHash !== after.metadata.promptHash;

  return Object.freeze({
    ...sections,
    equal:
      !promptHashChanged &&
      sections.added.length === 0 &&
      sections.changed.length === 0 &&
      sections.removed.length === 0 &&
      sections.reordered.length === 0,
    promptHashChanged,
  });
}
