import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { bus } from '../../shared/events.ts';
import type { GraphSnapshot } from '../../graph/model.ts';

const FLUSH_MS = 100;
const COLLAPSE_AFTER_MS = 5_000;
const MAX_LINES = 12;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface RenderLine {
  key: string;
  prefix: string;
  label: string;
  color?: 'gray' | 'green' | 'yellow' | 'red' | 'white';
}

export const TaskGraph = memo(function TaskGraph() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const pendingSnapshotRef = useRef<GraphSnapshot | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = bus.on('graph:update', ({ snapshot: nextSnapshot }) => {
      pendingSnapshotRef.current = nextSnapshot;
      if (flushTimerRef.current) {
        return;
      }

      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        setSnapshot(pendingSnapshotRef.current);
      }, FLUSH_MS);
    });

    return () => {
      off();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setSpinnerIndex((current) => (current + 1) % SPINNER_FRAMES.length);
    }, 80);
    timer.unref?.();
    return () => clearInterval(timer);
  }, []);

  const lines = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    return buildRenderLines(snapshot, spinnerIndex, Date.now());
  }, [snapshot, spinnerIndex]);

  if (!snapshot || snapshot.nodes.length <= 1 || lines.length === 0) {
    return null;
  }

  const visibleLines = lines.slice(0, MAX_LINES);
  const hiddenCount = Math.max(0, lines.length - visibleLines.length);

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Task graph</Text>
      {visibleLines.map((line) => (
        <Text key={line.key} color={line.color}>
          {`${line.prefix}${line.label}`}
        </Text>
      ))}
      {hiddenCount > 0 ? <Text color="gray">{`... and ${hiddenCount} more agents`}</Text> : null}
    </Box>
  );
});

function buildRenderLines(snapshot: GraphSnapshot, spinnerIndex: number, now: number): RenderLine[] {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();

  for (const node of snapshot.nodes) {
    if (!node.parentId) {
      continue;
    }
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }

  const root = nodes.get(snapshot.rootId);
  if (!root) {
    return [];
  }

  const rootChildren = children.get(root.id) ?? [];
  if (rootChildren.length === 0) {
    return [];
  }

  const lines: RenderLine[] = [
    {
      key: root.id,
      prefix: '',
      label: formatNodeLabel(root, spinnerIndex, now),
      color: getNodeColor(root.status),
    },
  ];

  rootChildren.forEach((childId, index) => {
    renderNode(lines, nodes, children, childId, '', index === rootChildren.length - 1, spinnerIndex, now);
  });

  return lines;
}

function renderNode(
  lines: RenderLine[],
  nodes: Map<string, GraphSnapshot['nodes'][number]>,
  children: Map<string, string[]>,
  nodeId: string,
  ancestorPrefix: string,
  isLast: boolean,
  spinnerIndex: number,
  now: number,
): void {
  const node = nodes.get(nodeId);
  if (!node) {
    return;
  }

  const prefix = `${ancestorPrefix}${isLast ? '└── ' : '├── '}`;
  const descendantIds = collectDescendants(children, nodeId);
  const childIds = children.get(nodeId) ?? [];
  const collapsed = shouldCollapse(node, descendantIds, nodes, now);

  lines.push({
    key: node.id,
    prefix,
    label: collapsed
      ? `${formatNodeLabel(node, spinnerIndex, now)} (+${descendantIds.length} finished subtasks)`
      : formatNodeLabel(node, spinnerIndex, now),
    color: getNodeColor(node.status),
  });

  if (collapsed) {
    return;
  }

  const nextPrefix = `${ancestorPrefix}${isLast ? '    ' : '│   '}`;
  childIds.forEach((childId, index) => {
    renderNode(lines, nodes, children, childId, nextPrefix, index === childIds.length - 1, spinnerIndex, now);
  });
}

function collectDescendants(children: Map<string, string[]>, nodeId: string): string[] {
  const direct = children.get(nodeId) ?? [];
  const all = [...direct];
  for (const childId of direct) {
    all.push(...collectDescendants(children, childId));
  }
  return all;
}

function shouldCollapse(
  node: GraphSnapshot['nodes'][number],
  descendantIds: string[],
  nodes: Map<string, GraphSnapshot['nodes'][number]>,
  now: number,
): boolean {
  if (descendantIds.length === 0 || node.status === 'running' || node.status === 'pending' || !node.finishedAt) {
    return false;
  }

  if (now - new Date(node.finishedAt).getTime() < COLLAPSE_AFTER_MS) {
    return false;
  }

  return descendantIds.every((id) => {
    const child = nodes.get(id);
    return child && child.status !== 'running' && child.status !== 'pending';
  });
}

function formatNodeLabel(
  node: GraphSnapshot['nodes'][number],
  spinnerIndex: number,
  now: number,
): string {
  const statusIcon = getStatusIcon(node.status, spinnerIndex);
  const description = truncate(node.description, 56);
  const model = node.model;
  const elapsed = node.finishedAt
    ? ` (${formatDuration(new Date(node.startedAt).getTime(), new Date(node.finishedAt).getTime())})`
    : node.status === 'running'
      ? ` (${formatDuration(new Date(node.startedAt).getTime(), now)})`
      : '';

  return `${statusIcon} ${node.id === 'root' ? 'root agent' : node.id} [${node.status}] "${description}" (${model})${elapsed}`;
}

function getStatusIcon(status: GraphSnapshot['nodes'][number]['status'], spinnerIndex: number): string {
  switch (status) {
    case 'running':
      return SPINNER_FRAMES[spinnerIndex];
    case 'done':
      return '✓';
    case 'failed':
      return '✕';
    default:
      return '•';
  }
}

function getNodeColor(status: GraphSnapshot['nodes'][number]['status']): RenderLine['color'] {
  switch (status) {
    case 'running':
      return 'yellow';
    case 'done':
      return 'green';
    case 'failed':
      return 'red';
    default:
      return 'gray';
  }
}

function formatDuration(startMs: number, endMs: number): string {
  return `${Math.max(0, endMs - startMs) / 1000 < 10
    ? ((endMs - startMs) / 1000).toFixed(1)
    : Math.round((endMs - startMs) / 1000)}s`;
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, Math.max(0, length - 3))}...`;
}
