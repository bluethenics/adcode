/** `node:events` for the browser host: the EventEmitter the main process and the Electron shim extend. */
type Listener = (...args: any[]) => void;

export class EventEmitter {
  static defaultMaxListeners = 10;
  private readonly listenersByName = new Map<string | symbol, Listener[]>();

  on(name: string | symbol, listener: Listener): this {
    const list = this.listenersByName.get(name) ?? [];
    list.push(listener);
    this.listenersByName.set(name, list);
    return this;
  }

  addListener(name: string | symbol, listener: Listener): this {
    return this.on(name, listener);
  }

  prependListener(name: string | symbol, listener: Listener): this {
    this.listenersByName.set(name, [listener, ...(this.listenersByName.get(name) ?? [])]);
    return this;
  }

  once(name: string | symbol, listener: Listener): this {
    const wrapped: Listener & { listener?: Listener } = (...args) => {
      this.off(name, wrapped);
      listener.apply(this, args);
    };
    wrapped.listener = listener;
    return this.on(name, wrapped);
  }

  off(name: string | symbol, listener: Listener): this {
    const list = this.listenersByName.get(name);
    if (list === undefined) return this;
    const index = list.findIndex((one) => one === listener || (one as { listener?: Listener }).listener === listener);
    if (index >= 0) list.splice(index, 1);
    if (list.length === 0) this.listenersByName.delete(name);
    return this;
  }

  removeListener(name: string | symbol, listener: Listener): this {
    return this.off(name, listener);
  }

  removeAllListeners(name?: string | symbol): this {
    if (name === undefined) this.listenersByName.clear();
    else this.listenersByName.delete(name);
    return this;
  }

  emit(name: string | symbol, ...args: unknown[]): boolean {
    const list = this.listenersByName.get(name);
    if (list === undefined || list.length === 0) {
      if (name === "error") throw args[0] instanceof Error ? args[0] : new Error(String(args[0]));
      return false;
    }
    for (const listener of [...list]) listener.apply(this, args);
    return true;
  }

  listeners(name: string | symbol): Listener[] {
    return [...(this.listenersByName.get(name) ?? [])];
  }

  rawListeners(name: string | symbol): Listener[] {
    return this.listeners(name);
  }

  listenerCount(name: string | symbol): number {
    return this.listenersByName.get(name)?.length ?? 0;
  }

  eventNames(): (string | symbol)[] {
    return [...this.listenersByName.keys()];
  }

  setMaxListeners(): this {
    return this;
  }

  getMaxListeners(): number {
    return EventEmitter.defaultMaxListeners;
  }
}

export function once(emitter: EventEmitter, name: string): Promise<unknown[]> {
  return new Promise((resolve) => emitter.once(name, (...args: unknown[]) => resolve(args)));
}

export default EventEmitter;
