export const pendingActionOperationTtlMs = 24 * 60 * 60 * 1_000;

export interface PersistedActionOperation {
  readonly scope: string;
  readonly action: string;
  readonly key: string;
  readonly requestDigest: string;
  readonly createdAt: string;
}

export interface ActionOperationPersistence {
  load(scope: string, action: string): Promise<unknown>;
  save(operation: PersistedActionOperation): Promise<void>;
  remove(scope: string, action: string): Promise<void>;
  clear(): Promise<void>;
}

function operationIdentity(scope: string, action: string): string {
  return `${scope.length}:${scope}${action.length}:${action}`;
}

function persistedActionOperation(value: unknown): PersistedActionOperation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.scope !== 'string' ||
    typeof candidate.action !== 'string' ||
    typeof candidate.key !== 'string' ||
    typeof candidate.requestDigest !== 'string' ||
    typeof candidate.createdAt !== 'string'
  ) {
    return undefined;
  }
  return {
    scope: candidate.scope,
    action: candidate.action,
    key: candidate.key,
    requestDigest: candidate.requestDigest,
    createdAt: candidate.createdAt,
  };
}

export class DurableActionOperationKeys {
  private readonly retained = new Map<string, PersistedActionOperation>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly persistence: ActionOperationPersistence,
    private readonly digest: (canonicalRequest: string) => Promise<string>,
    private readonly uuid: () => string,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs: number = pendingActionOperationTtlMs,
  ) {}

  private serialize<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.pending.then(work, work);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async retain(input: {
    readonly scope: string;
    readonly action: string;
    readonly canonicalRequest: string;
    readonly keyPrefix: string;
  }): Promise<string> {
    return this.serialize(() => this.retainSerial(input));
  }

  private async retainSerial(input: {
    readonly scope: string;
    readonly action: string;
    readonly canonicalRequest: string;
    readonly keyPrefix: string;
  }): Promise<string> {
    const identity = operationIdentity(input.scope, input.action);
    const requestDigest = await this.digest(input.canonicalRequest);
    if (!/^[a-f0-9]{64}$/u.test(requestDigest)) {
      throw new TypeError('Action-operation request digest must be SHA-256 hex');
    }
    const currentTime = this.now();
    const inMemory = this.retained.get(identity);
    const loaded =
      inMemory === undefined ? await this.persistence.load(input.scope, input.action) : undefined;
    const stored = inMemory ?? persistedActionOperation(loaded);
    if (inMemory === undefined && loaded !== undefined && stored === undefined) {
      await this.persistence.remove(input.scope, input.action);
    }
    if (stored !== undefined) {
      const createdAt = new Date(stored.createdAt);
      const ageMs = currentTime.getTime() - createdAt.getTime();
      const expectedPrefix = `${input.keyPrefix}:`;
      const uuid = stored.key.slice(expectedPrefix.length);
      const valid =
        stored.scope === input.scope &&
        stored.action === input.action &&
        stored.requestDigest === requestDigest &&
        /^[a-f0-9]{64}$/u.test(stored.requestDigest) &&
        stored.key.startsWith(expectedPrefix) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(uuid) &&
        !Number.isNaN(createdAt.getTime()) &&
        ageMs >= 0 &&
        ageMs <= this.ttlMs;
      if (valid) {
        this.retained.set(identity, stored);
        return stored.key;
      }
      this.retained.delete(identity);
      await this.persistence.remove(input.scope, input.action);
    }
    const operation: PersistedActionOperation = {
      scope: input.scope,
      action: input.action,
      key: `${input.keyPrefix}:${this.uuid()}`,
      requestDigest,
      createdAt: currentTime.toISOString(),
    };
    await this.persistence.save(operation);
    this.retained.set(identity, operation);
    return operation.key;
  }

  async settle(input: {
    readonly scope: string;
    readonly action: string;
    readonly key: string;
  }): Promise<void> {
    return this.serialize(() => this.settleSerial(input));
  }

  private async settleSerial(input: {
    readonly scope: string;
    readonly action: string;
    readonly key: string;
  }): Promise<void> {
    const identity = operationIdentity(input.scope, input.action);
    const current =
      this.retained.get(identity) ??
      persistedActionOperation(await this.persistence.load(input.scope, input.action));
    if (current?.key !== input.key) return;
    this.retained.delete(identity);
    await this.persistence.remove(input.scope, input.action);
  }

  async clear(): Promise<void> {
    return this.serialize(async () => {
      this.retained.clear();
      await this.persistence.clear();
    });
  }
}
