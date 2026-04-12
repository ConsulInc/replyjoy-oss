import { Navigate, Route, Routes } from "react-router-dom";

import { commercialFrontendModule } from "@replyjoy/commercial-frontend";
import { SupportWidget } from "./components/support-widget";
import { AppLayout } from "./routes/app-layout";
import { DashboardPage } from "./routes/dashboard-page";
import { DraftsPage } from "./routes/drafts-page";
import { LandingPage } from "./routes/landing-page";
import { PrivacyPolicyPage } from "./routes/privacy-policy-page";
import { SettingsPage } from "./routes/settings-page";
import { TermsOfServicePage } from "./routes/terms-of-service-page";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="drafts" element={<DraftsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {commercialFrontendModule.routes.map(({ path, component: Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SupportWidget />
    </>
  );
}
