import { randomUUID } from 'node:crypto';
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { db, MutationLogStatus, type Prisma } from '@mygroomtime/db';

const MUTATION_HEADER = 'x-mutation-id';
// why: existing tests (chunks 1–17) pre-date this middleware and don't send the header.
// In test mode we auto-generate one so they don't all break. Tests that EXERCISE the
// missing-header behavior set `X-Test-Skip-Mutation-Autogen: 1` to opt out.
const TEST_SKIP_AUTOGEN_HEADER = 'x-test-skip-mutation-autogen';
// why: client-generated UUIDv7s are 36 chars with hyphens. We accept canonical-format UUIDs
// of any version (v4 is fine in tests; the web client emits v7 for natural sortability).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MutationContext = {
  id: string;
  endpoint: string;
  resourceType: string;
  // why: handler can stash the new row's id here so the onResponse hook can persist it in
  // MutationLog.resourceId — handy for the operator log in chunk 22.
  resourceId: string | null;
  recorded: boolean;
};

// why: we capture the serialized response body in onSend (sync, before writeHead) and
// persist the MutationLog row in onResponse (after writableEnded). Capturing in onSend
// avoids contending with Fastify's wrap-thenable double-send pattern (route handlers that
// call reply.send() AND return undefined kick off two onSendHook chains; if either chain
// awaits, safeWriteHead throws ERR_HTTP_HEADERS_SENT). Persisting in onResponse keeps the
// DB write off the response-write path.
type CapturedBody = { body: unknown; statusCode: number };

export function makeMutationDedupe(opts: {
  resourceType: string;
  endpointLabel?: string;
}): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.auth) return;

    const raw = request.headers[MUTATION_HEADER];
    const headerValue = Array.isArray(raw) ? raw[0] : raw;
    let mutationId = typeof headerValue === 'string' ? headerValue.trim() : '';

    if (!mutationId) {
      const isTest = request.server.appEnv.nodeEnv === 'test';
      const optOut = request.headers[TEST_SKIP_AUTOGEN_HEADER] === '1';
      if (isTest && !optOut) {
        mutationId = randomUUID();
      } else {
        reply.code(400).send({
          error: 'mutation_id_required',
          reason: 'mutation_id_required',
          message:
            'This endpoint requires the X-Mutation-Id header. Update your client.',
        });
        return;
      }
    }
    if (!UUID_RE.test(mutationId)) {
      reply.code(400).send({
        error: 'mutation_id_required',
        reason: 'mutation_id_invalid',
        message: 'X-Mutation-Id must be a canonical UUID.',
      });
      return;
    }

    const tenantId = request.auth.tenant.id;
    const route = (request as { routeOptions?: { url?: string } }).routeOptions?.url;
    const endpoint = opts.endpointLabel ?? `${request.method} ${route ?? request.url}`;

    const existing = await db.global.mutationLog.findUnique({
      where: { id: mutationId },
    });

    if (existing) {
      if (existing.tenantId !== tenantId) {
        reply.code(400).send({
          error: 'mutation_id_conflict',
          reason: 'mutation_id_conflict',
          message: 'Mutation id was used by another account.',
        });
        return;
      }
      reply.code(existing.statusCode);
      if (existing.resultPayloadJson === null || existing.resultPayloadJson === undefined) {
        reply.send();
      } else {
        reply.send(existing.resultPayloadJson);
      }
      return;
    }

    request.mutation = {
      id: mutationId,
      endpoint,
      resourceType: opts.resourceType,
      resourceId: null,
      recorded: false,
    };
  };
}

// why: registered globally at app boot. Fires after the handler sets the response status +
// body. We record 2xx + 4xx; 5xx skip (let client retry on its own). Handlers may have set
// request.mutation.resourceId via `recordResourceId` if they want it captured.
type RequestWithCapture = FastifyRequest & { __mutationCaptured?: CapturedBody };

export function captureMutationPayload(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): void {
  // why: SYNC hook. Just snapshots the body + status for later persistence. Never awaits
  // and never modifies the response. Subsequent invocations from Fastify's wrap-thenable
  // double-send are no-ops because we keep the FIRST captured payload.
  const ctx = request.mutation;
  if (!ctx) return;
  const r = request as RequestWithCapture;
  if (r.__mutationCaptured) return;
  r.__mutationCaptured = { body: payload, statusCode: reply.statusCode };
}

export async function persistMutationLog(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ctx = request.mutation;
  if (!ctx || ctx.recorded) return;
  const r = request as RequestWithCapture;
  const captured = r.__mutationCaptured;
  if (!captured) return;
  const statusCode = captured.statusCode || reply.statusCode;
  if (statusCode >= 500 || statusCode < 200) return;
  ctx.recorded = true;
  const body = parseBody(captured.body);
  const resourceId = ctx.resourceId ?? extractResourceId(body, ctx.resourceType);
  const status =
    statusCode >= 200 && statusCode < 300
      ? MutationLogStatus.processed
      : MutationLogStatus.failed;
  const failureReason =
    status === MutationLogStatus.failed && isObject(body)
      ? typeof body.error === 'string'
        ? body.error
        : typeof body.reason === 'string'
          ? body.reason
          : null
      : null;
  try {
    await db.global.mutationLog.upsert({
      where: { id: ctx.id },
      create: {
        id: ctx.id,
        tenantId: request.auth!.tenant.id,
        userId: request.auth!.user.id,
        endpoint: ctx.endpoint,
        resourceType: ctx.resourceType,
        resourceId,
        status,
        statusCode,
        failureReason,
        resultPayloadJson: serializeForJson(body) ?? undefined,
      },
      update: {},
    });
  } catch (err) {
    // why: a persistence failure shouldn't break the response (it's already sent). The
    // operator log (chunk 22) will surface these.
    request.log.warn({ err, mutationId: ctx.id }, 'mutation-log persistence failed');
  }
}

function parseBody(payload: unknown): unknown {
  if (payload === undefined || payload === null || payload === '') return null;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }
  if (Buffer.isBuffer(payload)) {
    try {
      return JSON.parse(payload.toString('utf8'));
    } catch {
      return null;
    }
  }
  return payload;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractResourceId(body: unknown, resourceType: string): string | null {
  if (!isObject(body)) return null;
  // why: most write endpoints in this codebase return { <resource>: { id, ... }, ... }.
  // We look for the resource by type, then fall back to a top-level `id`.
  const candidate = body[resourceType];
  if (isObject(candidate) && typeof candidate.id === 'string') return candidate.id;
  if (typeof body.id === 'string') return body.id;
  // chunk-specific: appointment routes nest as `appointment`; rebook returns nextAppointment.
  if (resourceType === 'appointment') {
    const nested = body.appointment ?? body.nextAppointment;
    if (isObject(nested) && typeof nested.id === 'string') return nested.id;
  }
  if (resourceType === 'recurring_series') {
    const nested = body.series ?? body.recurringSeries;
    if (isObject(nested) && typeof nested.id === 'string') return nested.id;
  }
  return null;
}

function serializeForJson(v: unknown): Prisma.InputJsonValue | null {
  if (v === undefined || v === null) return null;
  try {
    return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

export const MUTATION_ID_HEADER = MUTATION_HEADER;
