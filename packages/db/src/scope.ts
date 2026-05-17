type Where = Record<string, unknown>;
type Data = Record<string, unknown>;

export interface DelegateWithWhere {
  findMany: (args?: { where?: Where } & Record<string, unknown>) => Promise<unknown>;
  findFirst: (args?: { where?: Where } & Record<string, unknown>) => Promise<unknown>;
  findFirstOrThrow: (args?: { where?: Where } & Record<string, unknown>) => Promise<unknown>;
  count: (args?: { where?: Where } & Record<string, unknown>) => Promise<unknown>;
  create: (args: { data: Data } & Record<string, unknown>) => Promise<unknown>;
  createMany: (args: { data: Data | Data[] } & Record<string, unknown>) => Promise<unknown>;
  update: (args: { where: Where; data: Data } & Record<string, unknown>) => Promise<unknown>;
  updateMany: (args: { where?: Where; data: Data } & Record<string, unknown>) => Promise<unknown>;
  delete: (args: { where: Where } & Record<string, unknown>) => Promise<unknown>;
  deleteMany: (args?: { where?: Where } & Record<string, unknown>) => Promise<unknown>;
  aggregate: (args?: { where?: Where } & Record<string, unknown>) => Promise<unknown>;
}

function injectWhere<A extends { where?: Where }>(args: A | undefined, tenantId: string): A {
  const base = args ?? ({} as A);
  // why: the wrapper unconditionally overrides any caller-supplied tenantId so cross-tenant
  // queries cannot be smuggled through the scoped delegate.
  return { ...base, where: { ...(base.where ?? {}), tenantId } } as A;
}

function injectData<A extends { data: Data | Data[] }>(args: A, tenantId: string): A {
  const data = Array.isArray(args.data)
    ? args.data.map((row) => ({ ...row, tenantId }))
    : { ...args.data, tenantId };
  return { ...args, data } as A;
}

export function scopeDelegate(delegate: DelegateWithWhere, tenantId: string): DelegateWithWhere {
  return {
    findMany: (args) => delegate.findMany(injectWhere(args, tenantId)),
    findFirst: (args) => delegate.findFirst(injectWhere(args, tenantId)),
    findFirstOrThrow: (args) => delegate.findFirstOrThrow(injectWhere(args, tenantId)),
    count: (args) => delegate.count(injectWhere(args, tenantId)),
    create: (args) => delegate.create(injectData(args, tenantId)),
    createMany: (args) => delegate.createMany(injectData(args, tenantId)),
    update: (args) => delegate.update(injectWhere(args, tenantId)),
    updateMany: (args) => delegate.updateMany(injectWhere(args, tenantId)),
    delete: (args) => delegate.delete(injectWhere(args, tenantId)),
    deleteMany: (args) => delegate.deleteMany(injectWhere(args, tenantId)),
    aggregate: (args) => delegate.aggregate(injectWhere(args, tenantId)),
  };
}
