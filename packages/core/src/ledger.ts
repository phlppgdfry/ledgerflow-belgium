export const documentStatuses = [
  'RECEIVED',
  'VALIDATED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'POSTED',
  'REJECTED',
] as const;

export type DocumentStatus = (typeof documentStatuses)[number];

const transitions: Record<DocumentStatus, readonly DocumentStatus[]> = {
  RECEIVED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['REVIEW_REQUIRED', 'APPROVED', 'REJECTED'],
  REVIEW_REQUIRED: ['APPROVED', 'REJECTED'],
  APPROVED: ['POSTED', 'REVIEW_REQUIRED'],
  POSTED: [],
  REJECTED: [],
};

export function canTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: DocumentStatus, to: DocumentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid financial document transition: ${from} → ${to}`);
  }
}

export type AuditEvent = Readonly<{
  id: string;
  documentId: string;
  type: 'DOCUMENT_IMPORTED' | 'STATUS_CHANGED' | 'FIELD_CORRECTED' | 'DOCUMENT_POSTED';
  actor: string;
  occurredAt: string;
  correlationId: string;
  detail: string;
}>;
