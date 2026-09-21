import { createLoadTokens, step, checkpoint, runLoad, StaleLoad, LoadError } from './staleness';

const later = (value) => new Promise(resolve => setTimeout(() => resolve(value), 0));

describe('load tokens', () => {
  it('leaves the newest load live', () => {
    const tokens = createLoadTokens();
    const first = tokens.begin();
    expect(first.stale()).toBe(false);
  });

  it('invalidates an earlier load as soon as a newer one begins', () => {
    // This is the whole point: a slow first load must not finish last and
    // overwrite the scene a newer drop has claimed.
    const tokens = createLoadTokens();
    const first = tokens.begin();
    const second = tokens.begin();
    expect(first.stale()).toBe(true);
    expect(second.stale()).toBe(false);
  });

  it('keeps only the last of several loads live', () => {
    const tokens = createLoadTokens();
    const signals = [tokens.begin(), tokens.begin(), tokens.begin()];
    expect(signals.map(s => s.stale())).toEqual([true, true, false]);
  });
});

describe('step', () => {
  it('returns the awaited value while the load is current', async () => {
    const tokens = createLoadTokens();
    await expect(step(tokens.begin(), later('content'))).resolves.toBe('content');
  });

  it('throws StaleLoad if a newer load began while awaiting', async () => {
    // The check is part of awaiting, so a step cannot forget it — which six
    // hand-placed `if (isStale()) return` checks could.
    const tokens = createLoadTokens();
    const signal = tokens.begin();
    const pending = step(signal, later('content'));
    tokens.begin();
    await expect(pending).rejects.toThrow(StaleLoad);
  });

  it('lets the original error through rather than masking it', async () => {
    const tokens = createLoadTokens();
    await expect(step(tokens.begin(), Promise.reject(new Error('unreadable'))))
      .rejects.toThrow('unreadable');
  });
});

describe('checkpoint', () => {
  it('passes while current and throws once superseded', () => {
    const tokens = createLoadTokens();
    const signal = tokens.begin();
    expect(() => checkpoint(signal)).not.toThrow();
    tokens.begin();
    expect(() => checkpoint(signal)).toThrow(StaleLoad);
  });
});

describe('runLoad', () => {
  it('reports success', async () => {
    expect(await runLoad(async () => {})).toEqual({ ok: true });
  });

  it('reports a superseded load as neither success nor failure', async () => {
    // A newer drop owning the scene is not an error: alerting the user or
    // resetting the drop zone here would fight the load that took over.
    const outcome = await runLoad(async () => { throw new StaleLoad(); });
    expect(outcome).toEqual({ ok: false, superseded: true });
    expect(outcome.message).toBeUndefined();
  });

  it('passes a LoadError message through for the person to read', async () => {
    const outcome = await runLoad(async () => {
      throw new LoadError('No topology file detected.');
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.superseded).toBeUndefined();
    expect(outcome.message).toBe('No topology file detected.');
  });

  it('reports an unexpected error with its message, and keeps the error', async () => {
    const outcome = await runLoad(async () => { throw new TypeError('x is not a function'); });
    expect(outcome.message).toBe('x is not a function');
    expect(outcome.error).toBeInstanceOf(TypeError);
  });
});
