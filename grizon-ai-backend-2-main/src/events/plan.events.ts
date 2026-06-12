import { EventEmitter } from "events";

export type PlanModuleEvent =
  | { type: "plan.created"; payload: { planId: string; actorUserId: string } }
  | { type: "plan.updated"; payload: { planId: string; actorUserId: string } }
  | { type: "plan.archived"; payload: { planId: string; actorUserId: string } }
  | { type: "plan.published"; payload: { planId: string; actorUserId: string } }
  | {
      type: "subscription.created";
      payload: { userId: string; subscriptionId: string; planId: string };
    }
  | {
      type: "subscription.upgraded";
      payload: {
        userId: string;
        fromPlanId: string;
        toPlanId: string;
        billingCycle: string;
        creditsGranted: number;
        creditsRolledOver: number;
      };
    }
  | { type: "subscription.cancel_scheduled"; payload: { userId: string; effectiveAt: string } }
  | { type: "subscription.cancelled"; payload: { userId: string; sourcePlanId: string } }
  | { type: "subscription.renewed"; payload: Record<string, unknown> }
  | { type: "subscription.admin_adjusted"; payload: { subscriptionId: string; actorUserId: string } };

class TypedEmitter extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

export const planEvents = new TypedEmitter();
