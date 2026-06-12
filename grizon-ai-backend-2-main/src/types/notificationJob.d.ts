export interface NotificationJobPayload {
  userId: string;
  template: "welcome" | "new_device" | "password_changed" | "banned" | "topup_succeeded" | "rate_limit_flagged";
  vars: Record<string, string | number>;
  channels: Array<"email" | "push">;
}
