import type { BookingConfirmationEmail, EmailAdapter, MagicLinkEmail } from './index.js';

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
    async sendBookingConfirmation(msg: BookingConfirmationEmail): Promise<void> {
      const banner = '='.repeat(20);
      const lines = [
        `${banner} BOOKING CONFIRMED ${banner}`,
        `To:       ${msg.to}`,
        `From:     ${msg.businessName}`,
        `Customer: ${msg.customerName}`,
        `Service:  ${msg.serviceName}`,
        `When:     ${msg.start}`,
        `Where:    ${msg.addressLine}`,
        `Deposit:  ${msg.depositAmount}`,
        `${banner}===================${banner}`,
      ];
      process.stdout.write(lines.join('\n') + '\n');
    },
  };
}
