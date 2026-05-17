import { describe, it, expect } from 'vitest';
import { detectAppMode } from './subdomain';

describe('detectAppMode', () => {
  it('treats bare localhost as groomer', () => {
    expect(detectAppMode('localhost')).toEqual({ kind: 'groomer' });
  });

  it('treats <slug>.localhost as a public booking page', () => {
    expect(detectAppMode('demo.localhost')).toEqual({ kind: 'public', slug: 'demo' });
  });

  it('treats app.localhost as the groomer app', () => {
    expect(detectAppMode('app.localhost')).toEqual({ kind: 'groomer' });
  });

  it('treats www.localhost as the groomer app', () => {
    expect(detectAppMode('www.localhost')).toEqual({ kind: 'groomer' });
  });

  it('treats apex mygroomtime.com as groomer', () => {
    expect(detectAppMode('mygroomtime.com')).toEqual({ kind: 'groomer' });
  });

  it('treats www.mygroomtime.com as groomer (reserved)', () => {
    expect(detectAppMode('www.mygroomtime.com')).toEqual({ kind: 'groomer' });
  });

  it('treats app.mygroomtime.com as groomer (reserved)', () => {
    expect(detectAppMode('app.mygroomtime.com')).toEqual({ kind: 'groomer' });
  });

  it('treats api.mygroomtime.com as groomer (reserved)', () => {
    expect(detectAppMode('api.mygroomtime.com')).toEqual({ kind: 'groomer' });
  });

  it('treats <slug>.mygroomtime.com as public', () => {
    expect(detectAppMode('plano-pup-spa.mygroomtime.com')).toEqual({
      kind: 'public',
      slug: 'plano-pup-spa',
    });
  });

  it('lowercases the slug', () => {
    expect(detectAppMode('DEMO.localhost')).toEqual({ kind: 'public', slug: 'demo' });
  });

  it('rejects invalid slug shapes as groomer (defensive)', () => {
    expect(detectAppMode('.localhost')).toEqual({ kind: 'groomer' });
  });
});
