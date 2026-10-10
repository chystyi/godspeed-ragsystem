export interface QueryResult {
  data?: unknown;
  error?: { message: string; code: string } | null;
}

export interface RecordedCall {
  kind: 'from' | 'rpc';
  name: string;
  /** For `rpc`: the arguments. */
  args?: unknown;
  /** For `from`: every builder method that was chained, in order. */
  chain: [method: string, args: unknown[]][];
}

/**
 * A stand-in for the supabase-js client. Every query returns the next queued result, and the
 * chain of calls that led to it is recorded, so tests can check what was asked for without
 * a database.
 */
export function fakeSupabase(...results: QueryResult[]) {
  const queue = [...results];
  const calls: RecordedCall[] = [];

  const builder = (call: RecordedCall) => {
    const settled = () => ({ data: null, error: null, ...(queue.shift() ?? {}) });
    const proxy: object = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === 'then') {
            return (resolve: (value: unknown) => void) => resolve(settled());
          }
          return (...args: unknown[]) => {
            call.chain.push([property, args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const client = {
    from(name: string) {
      const call: RecordedCall = { kind: 'from', name, chain: [] };
      calls.push(call);
      return builder(call);
    },
    rpc(name: string, args: unknown) {
      const call: RecordedCall = { kind: 'rpc', name, args, chain: [] };
      calls.push(call);
      return builder(call);
    },
  };
  return { client, calls };
}

export const methodsOf = (call: RecordedCall) => call.chain.map(([method]) => method);
export const argsOf = (call: RecordedCall, method: string) => call.chain.find(([name]) => name === method)?.[1];
