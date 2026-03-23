import type { ResolvedConfig } from '../../config/schema.ts';

export class Notifier {
  private readonly mode: ResolvedConfig['notifications'];

  constructor(config: ResolvedConfig) {
    this.mode = config.notifications;
  }

  notifyPermissionPrompt(): void {
    this.notify('Permission prompt waiting for input');
  }

  notifyTurnComplete(message: string): void {
    this.notify(message);
  }

  private notify(_message: string): void {
    if (this.mode === 'off') {
      return;
    }

    if (this.mode === 'iterm2' && (process.env.TERM_PROGRAM ?? '') === 'iTerm.app') {
      process.stdout.write('\u001b]9;IrisCode\u0007');
      return;
    }

    process.stdout.write('\x07');
  }
}
