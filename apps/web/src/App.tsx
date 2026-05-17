import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth-context';
import { AppQueryProvider } from './lib/query-client';
import { BillingGuard, RequireAnon, RequireAuth } from './lib/route-guard';
import LoginRoute from './routes/login';
import SignupRoute from './routes/signup';
import MagicLinkRoute from './routes/magic-link';
import MagicLinkSentRoute from './routes/magic-link-sent';
import MagicLinkConsumeRoute from './routes/magic-link-consume';
import HomeRoute from './routes/home';
import ClientsListRoute from './routes/clients/list';
import NewClientRoute from './routes/clients/new';
import ClientDetailRoute from './routes/clients/detail';
import ServicesSettingsRoute from './routes/settings/services';
import CalendarRoute from './routes/calendar';
import SignupBillingRoute from './routes/signup/billing';
import SignupBillingSuccessRoute from './routes/signup/billing-success';
import BillingRoute from './routes/billing/index';

function Authed({ children }: { children: JSX.Element }): JSX.Element {
  return (
    <RequireAuth>
      <BillingGuard>{children}</BillingGuard>
    </RequireAuth>
  );
}

export default function App(): JSX.Element {
  return (
    <AppQueryProvider>
      <AuthProvider>
        <BrowserRouter>
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
              element={<Navigate to="/settings/services" replace />}
            />
            <Route
              path="/settings/services"
              element={
                <Authed>
                  <ServicesSettingsRoute />
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
