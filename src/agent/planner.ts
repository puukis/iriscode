import { getPermissionRiskLevel } from '../ui/components/permission-prompt.tsx';

export interface PlannedStep {
  name: string;
  input: Record<string, unknown>;
}

interface PlannerOptions {
  askUser?: (question: string) => Promise<string>;
  onInfo?: (text: string) => void;
}

export class Planner {
  private readonly askUser?: PlannerOptions['askUser'];
  private readonly onInfo?: PlannerOptions['onInfo'];

  constructor(options: PlannerOptions = {}) {
    this.askUser = options.askUser;
    this.onInfo = options.onInfo;
  }

  async reviewAndDecide(steps: PlannedStep[]): Promise<'run' | 'cancel'> {
    if (steps.length === 0) {
      return 'cancel';
    }

    this.onInfo?.(this.renderSummary(steps));
    if (!this.askUser) {
      return 'cancel';
    }

    const answer = await this.askUser('Execute this plan? (y = run all, n = cancel, s = step through)');
    if (/^(y|yes)$/i.test(answer.trim())) {
      return 'run';
    }
    if (/^(s|step)$/i.test(answer.trim())) {
      const approved = await this.stepThrough(steps);
      return approved ? 'run' : 'cancel';
    }

    this.onInfo?.('Plan cancelled.');
    return 'cancel';
  }

  renderSummary(steps: PlannedStep[]): string {
    const lines = ['[PLAN MODE] Planned steps:'];

    steps.forEach((step, index) => {
      const risk = getPermissionRiskLevel(step.name).toUpperCase();
      lines.push(`${index + 1}. ${step.name} [${risk}]`);
      lines.push(JSON.stringify(step.input, null, 2));
    });

    return lines.join('\n');
  }

  private async stepThrough(steps: PlannedStep[]): Promise<boolean> {
    if (!this.askUser) {
      return false;
    }

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      this.onInfo?.(
        `[PLAN MODE] Step ${index + 1}/${steps.length}: ${step.name}\n${JSON.stringify(step.input, null, 2)}`,
      );
      const answer = await this.askUser('Continue with this plan? (y/n)');
      if (!/^(y|yes)$/i.test(answer.trim())) {
        this.onInfo?.('Plan cancelled.');
        return false;
      }
    }

    return true;
  }
}
