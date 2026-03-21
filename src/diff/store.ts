import { bus } from '../shared/events.ts';
import type { DiffResult } from '../shared/types.ts';

export interface RecordedDiff {
  diff: DiffResult;
  decision: 'accepted' | 'rejected';
  timestamp: Date;
}

export class DiffStore {
  private readonly entries: RecordedDiff[] = [];

  add(diff: DiffResult, decision: 'accepted' | 'rejected'): void {
    this.entries.push({
      diff,
      decision,
      timestamp: new Date(),
    });

    bus.emit('diff:decision', {
      filePath: diff.filePath,
      decision,
      stats: diff.stats,
    });
  }

  list(): RecordedDiff[] {
    return [...this.entries];
  }

  getByFile(filePath: string): RecordedDiff[] {
    return this.entries.filter((entry) => entry.diff.filePath === filePath);
  }

  summary(): string {
    const accepted = this.entries.filter((entry) => entry.decision === 'accepted').length;
    const rejected = this.entries.filter((entry) => entry.decision === 'rejected').length;
    const uniqueFiles = new Set(this.entries.map((entry) => entry.diff.filePath)).size;
    return `${accepted} edits accepted, ${rejected} rejected across ${uniqueFiles} files`;
  }
}
