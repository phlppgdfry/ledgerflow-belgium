import { describe, expect, it } from 'vitest';
import {
  InMemoryLedger,
  demoDocuments,
  nextActions,
  parseEuroToCents,
  splitVat,
} from '../src/index.js';

const input = {
  kind: 'PURCHASE' as const,
  supplier: 'Luminus',
  invoiceNumber: 'LUM-1',
  grossCents: 12100,
  vatRateBasisPoints: 2100,
  dueDate: '2026-12-01',
  category: 'Energy',
  confidence: 0.95,
  idempotencyKey: 'mail:lum-1',
};

describe('InMemoryLedger', () => {
  it('computes recoverable VAT per document rate, not a hard-coded 21%', () => {
    const ledger = new InMemoryLedger(demoDocuments(new Date('2026-11-17')));
    const expected = demoDocuments()
      .filter((d) => d.kind === 'PURCHASE')
      .reduce((sum, d) => sum + splitVat(d.grossCents, d.vatRateBasisPoints).vat.cents, 0);
    expect(ledger.dashboard().metrics.recoverableVatCents).toBe(expected);
  });

  it('imports idempotently: a retried delivery returns the original document', () => {
    const ledger = new InMemoryLedger([]);
    const first = ledger.import(input, 'c-1');
    const retry = ledger.import({ ...input, grossCents: 99999 }, 'c-2');
    expect(retry.duplicate).toBe(true);
    expect(retry.document.id).toBe(first.document.id);
    expect(retry.document.grossCents).toBe(12100);
    expect(ledger.dashboard().documents).toHaveLength(1);
  });

  it('writes an audit event with actor and correlation ID for every change', () => {
    const ledger = new InMemoryLedger([]);
    const { document } = ledger.import(input, 'c-1');
    ledger.transition(document.id, 'VALIDATED', 'ops.anna', 'c-2');
    const [latest] = ledger.dashboard().auditEvents;
    expect(latest).toMatchObject({
      documentId: document.id,
      actor: 'ops.anna',
      correlationId: 'c-2',
      type: 'STATUS_CHANGED',
    });
  });

  it('refuses invalid transitions and low-confidence approvals', () => {
    const ledger = new InMemoryLedger([]);
    const { document } = ledger.import({ ...input, confidence: 0.6 }, 'c-1');
    expect(() => ledger.transition(document.id, 'POSTED', 'x', 'c')).toThrow(
      'Invalid financial document transition',
    );
    ledger.transition(document.id, 'VALIDATED', 'x', 'c');
    expect(() => ledger.transition(document.id, 'APPROVED', 'x', 'c')).toThrow(/below 85%/);
    expect(nextActions({ status: 'VALIDATED', confidence: 0.6 })).toEqual([
      'REVIEW_REQUIRED',
      'REJECTED',
    ]);
    expect(nextActions({ status: 'VALIDATED', confidence: 0.95 })).toEqual([
      'APPROVED',
      'REVIEW_REQUIRED',
      'REJECTED',
    ]);
    expect(nextActions({ status: 'APPROVED', confidence: 0.95 })).toEqual([
      'POSTED',
      'REVIEW_REQUIRED',
    ]);
    expect(nextActions({ status: 'POSTED', confidence: 1 })).toEqual([]);
  });

  it('keeps demo data relative to today', () => {
    const now = new Date('2030-03-01T12:00:00Z');
    const docs = demoDocuments(now);
    expect(docs.every((d) => d.dueDate >= '2030-03-01')).toBe(true);
  });
});

describe('parseEuroToCents', () => {
  it.each([
    ['99,80', 9980],
    ['99,8', 9980],
    ['99.80', 9980],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['€ 12', 1200],
    ['0,29', 29],
    ['1.234', 123400],
  ])('%s → %i cents', (text, cents) => {
    expect(parseEuroToCents(text)).toBe(cents);
  });
  it('rejects text that is not an amount', () => {
    expect(() => parseEuroToCents('twelve')).toThrow();
    expect(() => parseEuroToCents('-5')).toThrow();
  });
});
