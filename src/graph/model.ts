export type AgentStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AgentNode {
  id: string;
  parentId: string | null;
  description: string;
  status: AgentStatus;
  model: string;
  startedAt: Date;
  finishedAt?: Date;
  depth: number;
}

export interface TaskEdge {
  fromAgentId: string;
  toAgentId: string;
  taskDescription: string;
  result?: string;
}

export interface AgentGraph {
  nodes: Map<string, AgentNode>;
  edges: TaskEdge[];
  rootId: string;
}

export interface GraphSnapshot {
  rootId: string;
  nodes: Array<{
    id: string;
    parentId: string | null;
    description: string;
    status: AgentStatus;
    model: string;
    startedAt: string;
    finishedAt?: string;
    depth: number;
  }>;
  edges: TaskEdge[];
}

export function createGraph(rootDescription: string, model: string): AgentGraph {
  const rootNode: AgentNode = {
    id: 'root',
    parentId: null,
    description: rootDescription,
    status: 'pending',
    model,
    startedAt: new Date(),
    depth: 0,
  };

  return {
    nodes: new Map([[rootNode.id, rootNode]]),
    edges: [],
    rootId: rootNode.id,
  };
}

export function addNode(graph: AgentGraph, node: AgentNode): void {
  graph.nodes.set(node.id, node);
}

export function addEdge(graph: AgentGraph, edge: TaskEdge): void {
  graph.edges.push(edge);
}

export function updateNode(graph: AgentGraph, id: string, updates: Partial<AgentNode>): void {
  const current = graph.nodes.get(id);
  if (!current) {
    return;
  }

  graph.nodes.set(id, {
    ...current,
    ...updates,
  });
}

export function toSnapshot(graph: AgentGraph): GraphSnapshot {
  return {
    rootId: graph.rootId,
    nodes: Array.from(graph.nodes.values()).map((node) => ({
      ...node,
      startedAt: node.startedAt.toISOString(),
      finishedAt: node.finishedAt?.toISOString(),
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}
