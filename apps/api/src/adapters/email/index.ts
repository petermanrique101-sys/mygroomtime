export interface MagicLinkEmail {
  to: string;
  url: string;
}

export interface BookingConfirmationEmail {
  to: string;
  customerName: string;
  businessName: string;
  serviceName: string;
  start: string;
  addressLine: string;
  depositAmount: string;
}

export interface EmailAdapter {
  sendMagicLink(msg: MagicLinkEmail): Promise<void>;
  sendBookingConfirmation(msg: BookingConfirmationEmail): Promise<void>;
}

export { createStdoutEmailAdapter } from './stdout.js';
