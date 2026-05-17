import type { EmailAdapter, MagicLinkEmail } from './index.js';

export function createStdoutEmailAdapter(): EmailAdapter {
  return {
    async sendMagicLink(msg: MagicLinkEmail): Promise<void> {
      const banner = '='.repeat(20);
      const lines = [
        `${banner} MAGIC LINK ${banner}`,
        `To:  ${msg.to}`,
        `URL: ${msg.url}`,
        `${banner}=============${banner}`,
      ];
      process.stdout.write(lines.join('\n') + '\n');
    },
  };
}
