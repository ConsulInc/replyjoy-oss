import type {
  AccessRequirementResult,
  AccessState,
  EntitlementsService,
  RedeemAccessCodeResult,
} from "./entitlements.js";

function createAccessState(): AccessState {
  return {
    appMode: "oss",
    billingEnabled: false,
    hasAccess: true,
    subscription: null,
  };
}

function createAllowedResult(): AccessRequirementResult {
  return {
    allowed: true,
    accessState: createAccessState(),
  };
}

export const ossEntitlements: EntitlementsService = {
  async getAccessState() {
    return createAccessState();
  },

  async requireAccess() {
    return createAllowedResult();
  },

  async redeemAccessCode(): Promise<RedeemAccessCodeResult> {
    return {
      ok: false,
      status: 400,
      error: "Billing is disabled in OSS mode.",
      accessState: createAccessState(),
    };
  },
};
