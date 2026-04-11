export type AppMode = "oss" | "saas";

export type SubscriptionSummary = {
  id: string;
  status: string;
  accessSource: string;
  accessCodeLabel: string | null;
};

export type AccessState = {
  appMode: AppMode;
  billingEnabled: boolean;
  hasAccess: boolean;
  subscription: SubscriptionSummary | null;
};

export type AccessRequirementResult =
  | {
      allowed: true;
      accessState: AccessState;
    }
  | {
      allowed: false;
      status: number;
      error: string;
      accessState: AccessState;
    };

export type RedeemAccessCodeResult =
  | {
      ok: true;
      accessState: AccessState;
    }
  | {
      ok: false;
      status: number;
      error: string;
      accessState: AccessState;
    };

export interface EntitlementsService {
  getAccessState(userId: string): Promise<AccessState>;
  requireAccess(userId: string): Promise<AccessRequirementResult>;
  redeemAccessCode(userId: string, code: string): Promise<RedeemAccessCodeResult>;
}
