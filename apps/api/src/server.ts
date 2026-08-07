import cors from '@fastify/cors';
import Fastify from 'fastify';
import { documentStatuses } from '@ledgerflow/core';
import { z } from 'zod';
import { InMemoryLedgerRepository } from './repository.js';

const app = Fastify({ logger: true });
const repository = new InMemoryLedgerRepository();

await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok', service: 'ledgerflow-api' }));
app.get('/api/dashboard', async () => repository.list());

app.post('/api/documents/:id/transition', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z
    .object({ status: z.enum(documentStatuses), actor: z.string().min(1).default('demo.user') })
    .parse(request.body);
  try {
    return repository.transition(params.id, body.status, body.actor, request.id);
  } catch (error) {
    return reply
      .code(error instanceof Error && error.message === 'Document not found.' ? 404 : 409)
      .send({
        message: error instanceof Error ? error.message : 'Unknown error',
        correlationId: request.id,
      });
  }
});

app.post('/api/documents/import', async (request, reply) => {
  const body = z
    .object({
      kind: z.enum(['PURCHASE', 'SALE']),
      supplier: z.string().min(1),
      invoiceNumber: z.string().min(1),
      grossCents: z.number().int().nonnegative(),
      vatRateBasisPoints: z.number().int().min(0),
      dueDate: z.string().date(),
      category: z.string().min(1),
      confidence: z.number().min(0).max(1),
      idempotencyKey: z.string().min(8),
    })
    .parse(request.body);
  const document = repository.import(body);
  return reply.code(202).send({ document, correlationId: request.id });
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
