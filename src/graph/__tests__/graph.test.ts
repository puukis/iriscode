import { describe, expect, test } from 'bun:test';
import { bus } from '../../shared/events.ts';
import { GraphTracker } from '../tracker.ts';

describe('graph tracker', () => {
  test('records agent nodes, edges, and emits snapshots', () => {
    const tracker = new GraphTracker('Root task', 'test/root-model');
    const snapshots: number[] = [];
    const off = bus.on('graph:update', ({ snapshot }) => {
      snapshots.push(snapshot.nodes.length);
    });

    tracker.agentStarted('root', null, 'Root task', 'test/root-model', 0);
    tracker.taskDelegated('root', 'subagent-1', 'Inspect auth flow');
    tracker.agentStarted('subagent-1', 'root', 'Inspect auth flow', 'test/subagent-model', 1);
    tracker.taskResolved('root', 'subagent-1', 'Done');
    tracker.agentFinished('subagent-1', 'Done');
    off();

    const snapshot = tracker.getSnapshot();
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.edges[0]).toMatchObject({
      fromAgentId: 'root',
      toAgentId: 'subagent-1',
      taskDescription: 'Inspect auth flow',
      result: 'Done',
    });
    expect(snapshot.nodes.find((node) => node.id === 'subagent-1')?.status).toBe('done');
    expect(snapshots.length).toBeGreaterThan(0);
    expect(tracker.getSummary()).toContain('agents: 2');
  });
});
