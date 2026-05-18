import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuthOptional } from './lib/auth-context';
import { AppQueryProvider } from './lib/query-client';
import { BillingGuard, RequireAnon, RequireAuth } from './lib/route-guard';
import { OfflineBanner } from './components/offline-banner';
import LoginRoute from './routes/login';
import SignupRoute from './routes/signup';
import MagicLinkRoute from './routes/magic-link';
import MagicLinkSentRoute from './routes/magic-link-sent';
import MagicLinkConsumeRoute from './routes/magic-link-consume';
import HomeRoute from './routes/home';
import ClientsListRoute from './routes/clients/list';
import NewClientRoute from './routes/clients/new';
import ClientDetailRoute from './routes/clients/detail';
import SettingsIndexRoute from './routes/settings/index-page';
import ServicesSettingsRoute from './routes/settings/services';
import SettingsPaymentsRoute from './routes/settings/payments';
import SettingsBillingRoute from './routes/settings/billing';
import SettingsSmsRoute from './routes/settings/sms';
import SettingsGoogleCalendarRoute from './routes/settings/integrations/google-calendar';
import SettingsGoogleCalendarOperationsRoute from './routes/settings/integrations/google-calendar-operations';
import VehiclesSettingsRoute from './routes/settings/vehicles';
import PayrollRoute from './routes/payroll/index';
import CalendarRoute from './routes/calendar';
import SignupBillingRoute from './routes/signup/billing';
import SignupBillingSuccessRoute from './routes/signup/billing-success';
import BillingRoute from './routes/billing/index';
import DashboardRoute from './routes/dashboard';
import DashboardRevenueRoute from './routes/dashboard/revenue';
import DashboardNoShowsRoute from './routes/dashboard/no-shows';
import DashboardTopClientsRoute from './routes/dashboard/top-clients';
import DashboardGapsToFillRoute from './routes/dashboard/gaps-to-fill';

function Authed({ children }: { children: JSX.Element }): JSX.Element {
  return (
    <RequireAuth>
      <BillingGuard>{children}</BillingGuard>
    </RequireAuth>
  );
}

// why: only render the offline banner for authed groomer-app sessions. Public booking
// pages stay strictly online (customers won't book from a dead zone — out-of-scope per
// chunk 18). We could check subdomain here too but the auth gate is sufficient.
function AuthedOfflineBanner(): JSX.Element | null {
  const auth = useAuthOptional();
  if (!auth?.session) return null;
  return <OfflineBanner />;
}

export default function App(): JSX.Element {
  return (
    <AppQueryProvider>
      <AuthProvider>
        <BrowserRouter>
          <AuthedOfflineBanner />
          <Routes>
            <Route
              path="/login"
              element={
                <RequireAnon>
                  <LoginRoute />
                </RequireAnon>
              }
            />
            <Route
              path="/signup"
              element={
                <RequireAnon>
                  <SignupRoute />
                </RequireAnon>
              }
            />
            <Route
              path="/magic-link"
              element={
                <RequireAnon>
                  <MagicLinkRoute />
                </RequireAnon>
              }
            />
            <Route path="/magic-link/sent" element={<MagicLinkSentRoute />} />
            <Route path="/magic-link/consume" element={<MagicLinkConsumeRoute />} />
            <Route
              path="/signup/billing"
              element={
                <RequireAuth>
                  <SignupBillingRoute />
                </RequireAuth>
              }
            />
            <Route
              path="/signup/billing/success"
              element={
                <RequireAuth>
                  <SignupBillingSuccessRoute />
                </RequireAuth>
              }
            />
            <Route
              path="/billing"
              element={
                <RequireAuth>
                  <BillingRoute />
                </RequireAuth>
              }
            />
            <Route
              path="/calendar"
              element={
                <Authed>
                  <CalendarRoute />
                </Authed>
              }
            />
            <Route
              path="/home"
              element={
                <Authed>
                  <HomeRoute />
                </Authed>
              }
            />
            <Route
              path="/clients"
              element={
                <Authed>
                  <ClientsListRoute />
                </Authed>
              }
            />
            <Route
              path="/clients/new"
              element={
                <Authed>
                  <NewClientRoute />
                </Authed>
              }
            />
            <Route
              path="/clients/:id"
              element={
                <Authed>
                  <ClientDetailRoute />
                </Authed>
              }
            />
            <Route
              path="/settings"
              element={
                <Authed>
                  <SettingsIndexRoute />
                </Authed>
              }
            />
            <Route
              path="/settings/services"
              element={
                <Authed>
                  <ServicesSettingsRoute />
                </Authed>
              }
            />
            <Route
              path="/settings/payments"
              element={
                <Authed>
                  <SettingsPaymentsRoute />
                </Authed>
              }
            />
            <Route
              path="/settings/billing"
              element={
                <Authed>
                  <SettingsBillingRoute />
                </Authed>
              }
            />
            <Route
              path="/settings/sms"
              element={
                <Authed>
                  <SettingsSmsRoute />
                </Authed>
              }
            />
            <Route
              path="/settings/integrations/google-calendar"
              element={
                <Authed>
                  <SettingsGoogleCalendarRoute />
                </Authed>
              }
            />
            <Route
              path="/settings/integrations/google-calendar/operations"
              element={
                <Authed>
                  <SettingsGoogleCalendarOperationsRoute />
                </Authed>
              }
            />
            <Route
              path="/settings/vehicles"
              element={
                <Authed>
                  <VehiclesSettingsRoute />
                </Authed>
              }
            />
            <Route
              path="/payroll"
              element={
                <Authed>
                  <PayrollRoute />
                </Authed>
              }
            />
            <Route
              path="/dashboard"
              element={
                <Authed>
                  <DashboardRoute />
                </Authed>
              }
            />
            <Route
              path="/dashboard/revenue"
              element={
                <Authed>
                  <DashboardRevenueRoute />
                </Authed>
              }
            />
            <Route
              path="/dashboard/no-shows"
              element={
                <Authed>
                  <DashboardNoShowsRoute />
                </Authed>
              }
            />
            <Route
              path="/dashboard/top-clients"
              element={
                <Authed>
                  <DashboardTopClientsRoute />
                </Authed>
              }
            />
            <Route
              path="/dashboard/gaps-to-fill"
              element={
                <Authed>
                  <DashboardGapsToFillRoute />
                </Authed>
              }
            />
            <Route path="/" element={<Navigate to="/calendar" replace />} />
            <Route path="*" element={<Navigate to="/calendar" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </AppQueryProvider>
  );
}
