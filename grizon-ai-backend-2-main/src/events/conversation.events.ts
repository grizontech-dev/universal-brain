import { EventEmitter } from "events";

export type ConversationEvent =
  | { type: "conversation.created"; payload: { conversationId: string; userId: string } }
  | { type: "conversation.archived"; payload: { conversationId: string; userId: string } }
  | { type: "conversation.summarised"; payload: { conversationId: string; userId: string; tokensSaved?: number } }
  | { type: "message.finalised"; payload: { messageId: string; conversationId: string; userId: string; role: string } }
  | { type: "file.uploaded"; payload: { fileId: string; userId: string; conversationId: string | null } }
  | { type: "file.ready"; payload: { fileId: string; userId: string } }
  | { type: "artifact.created"; payload: { artifactId: string; userId: string; conversationId: string } };

class TypedEmitter extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

export const conversationEvents = new TypedEmitter();
