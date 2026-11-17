import { describe, expect, it } from 'vitest';
import { InMemoryLedger, demoDocuments } from '@ledgerflow/core';
import { buildApp } from '../src/app.js';

const invoice = {
  kind: 'PURCHASE',
  supplier: 'Luminus',
  invoiceNumber: 'LUM-77',
  grossCents: 24200,
  vatRateBasisPoints: 2100,
  dueDate: '2026-12-15',
  category: 'Energy',
  confidence: 0.93,
};

async function app() {
  return buildApp({ ledger: new InMemoryLedger(demoDocuments(new Date('2026-11-17'))) });
}

describe('LedgerFlow API', () => {
  it('answers health checks', async () => {
    const res = await (await app()).inject('/health');
    expect(res.json()).toEqual({ status: 'ok', service: 'ledgerflow-api' });
  });

  it('accepts an import once and returns the same document on a retry', async () => {
    const api = await app();
    const headers = { 'idempotency-key': 'mail:lum-77' };
    const first = await api.inject({
      method: 'POST',
      url: '/api/documents/import',
      payload: invoice,
      headers,
    });
    const retry = await api.inject({
      method: 'POST',
      url: '/api/documents/import',
      payload: invoice,
      headers,
    });
    expect(first.statusCode).toBe(202);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect(retry.json().document.id).toBe(first.json().document.id);
  });

  it('rejects an illegal transition with 409 and a correlation ID', async () => {
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/documents/doc-1005/transition',
      payload: { status: 'POSTED' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/RECEIVED → POSTED/);
    expect(res.json().correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('validates input with 400 instead of crashing', async () => {
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/documents/import',
      payload: { ...invoice, vatRateBasisPoints: 1900, idempotencyKey: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown documents', async () => {
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/documents/nope/transition',
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(404);
  });
});
