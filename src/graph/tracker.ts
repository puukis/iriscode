import { bus } from '../shared/events.ts';
import {
  addEdge,
  addNode,
  createGraph,
  toSnapshot,
  updateNode,
  type AgentGraph,
  type AgentNode,
  type GraphSnapshot,
} from './model.ts';

export class GraphTracker {
  private graph: AgentGraph;

  constructor(rootDescription: string, model: string) {
    this.graph = createGraph(rootDescription, model);
    this.emit();
  }

  agentStarted(
    id: string,
    parentId: string | null,
    description: string,
    model: string,
    depth: number,
  ): void {
    const existing = this.graph.nodes.get(id);
    if (existing) {
      updateNode(this.graph, id, {
        parentId,
        description,
        model,
        depth,
        status: 'running',
        startedAt: new Date(),
        finishedAt: undefined,
      });
    } else {
      addNode(this.graph, {
        id,
        parentId,
        description,
        status: 'running',
        model,
        startedAt: new Date(),
        depth,
      });
    }

    this.emit();
  }

  agentFinished(id: string, result: string): void {
    const node = this.graph.nodes.get(id);
    if (!node) {
      return;
    }

    updateNode(this.graph, id, {
      status: 'done',
      finishedAt: new Date(),
      description: node.description || result,
    });
    this.emit();
  }

  agentFailed(id: string, error: string): void {
    const node = this.graph.nodes.get(id);
    if (!node) {
      return;
    }

    updateNode(this.graph, id, {
      status: 'failed',
      finishedAt: new Date(),
      description: node.description || error,
    });
    this.emit();
  }

  taskDelegated(fromId: string, toId: string, description: string): void {
    addEdge(this.graph, {
      fromAgentId: fromId,
      toAgentId: toId,
      taskDescription: description,
    });
    this.emit();
  }

  taskResolved(fromId: string, toId: string, result: string): void {
    const edge = this.graph.edges.find(
      (candidate) => candidate.fromAgentId === fromId && candidate.toAgentId === toId,
    );
    if (!edge) {
      return;
    }

    edge.result = result;
    this.emit();
  }

  getSnapshot(): GraphSnapshot {
    return toSnapshot(this.graph);
  }

  getSummary(): string {
    const nodes = Array.from(this.graph.nodes.values());
    const done = nodes.filter((node) => node.status === 'done').length;
    const failed = nodes.filter((node) => node.status === 'failed').length;
    const startedAt = nodes.reduce<Date | null>(
      (earliest, node) => (!earliest || node.startedAt < earliest ? node.startedAt : earliest),
      null,
    );
    const finishedAt = nodes.reduce<Date | null>((latest, node) => {
      if (!node.finishedAt) {
        return latest;
      }
      return !latest || node.finishedAt > latest ? node.finishedAt : latest;
    }, null);
    const wallTimeMs =
      startedAt && finishedAt
        ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
        : 0;

    return [
      `agents: ${nodes.length}`,
      `succeeded: ${done}`,
      `failed: ${failed}`,
      `wall time: ${(wallTimeMs / 1000).toFixed(1)}s`,
    ].join(' | ');
  }

  private emit(): void {
    bus.emit('graph:update', { snapshot: this.getSnapshot() });
  }
}
