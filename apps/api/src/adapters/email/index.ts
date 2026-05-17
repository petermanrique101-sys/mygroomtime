export interface MagicLinkEmail {
  to: string;
  url: string;
}

export interface EmailAdapter {
  sendMagicLink(msg: MagicLinkEmail): Promise<void>;
}

export { createStdoutEmailAdapter } from './stdout.js';
