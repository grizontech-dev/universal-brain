import { EventEmitter } from "events";

export type SanitiserEvent =
  | {
      type: "sanitiser.injection_stripped";
      payload: { userId: string; route: string; patternsMatched: string[] };
    }
  | {
      type: "sanitiser.abuse_signal";
      payload: { userId: string; kind: "repeat_message" | "injection_burst" };
    };

class TypedEmitter extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

export const sanitiserEvents = new TypedEmitter();
