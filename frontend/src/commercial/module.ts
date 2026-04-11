import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export interface CommercialNavItem {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  end?: boolean;
  requiresBillingEnabled?: boolean;
}

export interface CommercialRoute {
  path: string;
  component: ComponentType;
}

export interface CommercialAccessEntry {
  to: string;
  label: string;
}

export interface CommercialFrontendModule {
  navItems: CommercialNavItem[];
  routes: CommercialRoute[];
  accessEntry?: CommercialAccessEntry;
}

export const emptyCommercialFrontendModule: CommercialFrontendModule = {
  navItems: [],
  routes: [],
};
