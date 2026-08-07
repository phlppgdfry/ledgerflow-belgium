import { assertTransition, type AuditEvent, type DocumentStatus } from '@ledgerflow/core';

export type FinancialDocument = {
  id: string;
  kind: 'PURCHASE' | 'SALE';
  supplier: string;
  invoiceNumber: string;
  grossCents: number;
  vatRateBasisPoints: number;
  dueDate: string;
  receivedAt: string;
  status: DocumentStatus;
  category: string;
  confidence: number;
  idempotencyKey: string;
  needsAttention: boolean;
};

export type Dashboard = {
  documents: FinancialDocument[];
  auditEvents: AuditEvent[];
  metrics: {
    outstandingCents: number;
    recoverableVatCents: number;
    reviewCount: number;
    postedThisMonth: number;
  };
};

const today = new Date().toISOString().slice(0, 10);
const seed: FinancialDocument[] = [
  {
    id: 'doc-1001',
    kind: 'PURCHASE',
    supplier: 'Proximus NV',
    invoiceNumber: 'PRX-2026-08112',
    grossCents: 9980,
    vatRateBasisPoints: 2100,
    dueDate: '2026-08-18',
    receivedAt: today,
    status: 'REVIEW_REQUIRED',
    category: 'Telecom',
    confidence: 0.74,
    idempotencyKey: 'mail:prx-2026-08112',
    needsAttention: true,
  },
  {
    id: 'doc-1002',
    kind: 'SALE',
    supplier: 'Studio North',
    invoiceNumber: 'LF-2026-0042',
    grossCents: 181500,
    vatRateBasisPoints: 2100,
    dueDate: '2026-08-09',
    receivedAt: '2026-08-01',
    status: 'POSTED',
    category: 'Consulting',
    confidence: 0.99,
    idempotencyKey: 'peppol:0088:LF42',
    needsAttention: false,
  },
  {
    id: 'doc-1003',
    kind: 'PURCHASE',
    supplier: 'Adobe Systems',
    invoiceNumber: 'AD-44718',
    grossCents: 7260,
    vatRateBasisPoints: 2100,
    dueDate: '2026-08-14',
    receivedAt: '2026-08-02',
    status: 'APPROVED',
    category: 'Software',
    confidence: 0.96,
    idempotencyKey: 'mail:ad-44718',
    needsAttention: false,
  },
  {
    id: 'doc-1004',
    kind: 'PURCHASE',
    supplier: 'Stationery Hub',
    invoiceNumber: 'SH-00391',
    grossCents: 4538,
    vatRateBasisPoints: 2100,
    dueDate: '2026-08-11',
    receivedAt: '2026-08-03',
    status: 'VALIDATED',
    category: 'Office',
    confidence: 0.92,
    idempotencyKey: 'upload:sha-8737',
    needsAttention: false,
  },
];

export class InMemoryLedgerRepository {
  private documents = [...seed];
  private auditEvents: AuditEvent[] = seed.map((document, index) => ({
    id: `audit-${index + 1}`,
    documentId: document.id,
    type: 'DOCUMENT_IMPORTED',
    actor: 'system',
    occurredAt: document.receivedAt + 'T09:00:00.000Z',
    correlationId: `import-${document.id}`,
    detail: `Imported ${document.invoiceNumber} through a verified channel.`,
  }));

  list(): Dashboard {
    const recoverableVatCents = this.documents
      .filter((d) => d.kind === 'PURCHASE' && d.status !== 'REJECTED')
      .reduce((sum, d) => sum + Math.round(d.grossCents - d.grossCents / 1.21), 0);
    return {
      documents: this.documents,
      auditEvents: this.auditEvents.slice().reverse(),
      metrics: {
        outstandingCents: this.documents
          .filter((d) => d.kind === 'SALE' && d.status === 'POSTED')
          .reduce((sum, d) => sum + d.grossCents, 0),
        recoverableVatCents,
        reviewCount: this.documents.filter((d) => d.needsAttention).length,
        postedThisMonth: this.documents.filter((d) => d.status === 'POSTED').length,
      },
    };
  }

  transition(
    id: string,
    status: DocumentStatus,
    actor: string,
    correlationId: string,
  ): FinancialDocument {
    const document = this.documents.find((item) => item.id === id);
    if (!document) throw new Error('Document not found.');
    assertTransition(document.status, status);
    const previous = document.status;
    document.status = status;
    document.needsAttention = status === 'REVIEW_REQUIRED';
    this.auditEvents.push({
      id: `audit-${crypto.randomUUID()}`,
      documentId: id,
      type: status === 'POSTED' ? 'DOCUMENT_POSTED' : 'STATUS_CHANGED',
      actor,
      occurredAt: new Date().toISOString(),
      correlationId,
      detail: `Status changed from ${previous} to ${status}.`,
    });
    return document;
  }

  import(
    input: Omit<FinancialDocument, 'id' | 'receivedAt' | 'status' | 'needsAttention'>,
  ): FinancialDocument {
    const duplicate = this.documents.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (duplicate) return duplicate;
    const document: FinancialDocument = {
      ...input,
      id: `doc-${crypto.randomUUID()}`,
      receivedAt: new Date().toISOString().slice(0, 10),
      status: 'RECEIVED',
      needsAttention: false,
    };
    this.documents.push(document);
    this.auditEvents.push({
      id: `audit-${crypto.randomUUID()}`,
      documentId: document.id,
      type: 'DOCUMENT_IMPORTED',
      actor: 'system',
      occurredAt: new Date().toISOString(),
      correlationId: input.idempotencyKey,
      detail: `Received ${input.invoiceNumber}; queued for validation.`,
    });
    return document;
  }
}
