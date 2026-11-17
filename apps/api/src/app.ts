import cors from '@fastify/cors';
import Fastify from 'fastify';
import { InMemoryLedger, NotFoundError, TransitionError, documentStatuses } from '@ledgerflow/core';
import { z, ZodError } from 'zod';

const importSchema = z.object({
  kind: z.enum(['PURCHASE', 'SALE']),
  supplier: z.string().trim().min(1),
  invoiceNumber: z.string().trim().min(1),
  grossCents: z.number().int().nonnegative(),
  vatRateBasisPoints: z.union([z.literal(0), z.literal(600), z.literal(1200), z.literal(2100)]),
  dueDate: z.string().date(),
  category: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  idempotencyKey: z.string().min(8),
});

export async function buildApp({ ledger = new InMemoryLedger(), logger = false } = {}) {
  const app = Fastify({ logger, genReqId: () => `req-${crypto.randomUUID().slice(0, 8)}` });
  await app.register(cors, { origin: true });

  // Every response carries the correlation ID, so a support question can be traced to one log line.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ message: 'Invalid request.', issues: error.issues, correlationId: request.id });
    }
    if (error instanceof NotFoundError)
      return reply.code(404).send({ message: error.message, correlationId: request.id });
    if (error instanceof TransitionError)
      return reply.code(409).send({ message: error.message, correlationId: request.id });
    request.log.error(error);
    return reply.code(500).send({ message: 'Unexpected error.', correlationId: request.id });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'ledgerflow-api' }));
  app.get('/api/dashboard', async () => ledger.dashboard());

  app.post('/api/documents/:id/transition', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ status: z.enum(documentStatuses), actor: z.string().min(1).default('demo.user') })
      .parse(request.body);
    return ledger.transition(id, body.status, body.actor, request.id);
  });

  app.post('/api/documents/import', async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'];
    const body = importSchema.parse({
      ...(request.body as object),
      ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {}),
    });
    const result = ledger.import(body, request.id);
    // 202: accepted for asynchronous validation. 200: this delivery was already processed.
    return reply.code(result.duplicate ? 200 : 202).send({ ...result, correlationId: request.id });
  });

  return app;
}
