import { costTracker } from '../../cost/tracker.ts';
import { formatCostReport } from '../../cost/reporter.ts';

export function runCostCommand(): void {
  const total = costTracker.total();
  console.log('\nIrisCode — Session Cost\n');
  console.log(formatCostReport(total));
  console.log();
}
