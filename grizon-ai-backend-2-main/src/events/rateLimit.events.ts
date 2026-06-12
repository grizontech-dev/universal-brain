import { EventEmitter } from "events";

class TypedEmitter extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

export const rateLimitEvents = new TypedEmitter();
