import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppQueryProvider } from '../../lib/query-client';
import PublicLandingRoute from './landing';
import PublicBookRoute from './book';
import PublicBookingDetailsRoute from './details';
import PublicBookedRoute from './booked';
import PublicManageNotImplementedRoute from './manage-not-implemented';
import PublicRescheduleRoute from './reschedule';

function useAllowIndexing(): void {
  useEffect(() => {
    const tag = document.getElementById('robots-tag');
    if (tag instanceof HTMLMetaElement) tag.content = 'all';
  }, []);
}

export default function PublicApp({ slug }: { slug: string }): JSX.Element {
  useAllowIndexing();
  return (
    <AppQueryProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to={`/public/${slug}`} replace />} />
          <Route path="/public/:slug" element={<PublicLandingRoute />} />
          <Route path="/public/:slug/book/:serviceId" element={<PublicBookRoute />} />
          <Route
            path="/public/:slug/book/:serviceId/details"
            element={<PublicBookingDetailsRoute />}
          />
          <Route path="/public/:slug/booked/:requestId" element={<PublicBookedRoute />} />
          <Route
            path="/public/:slug/manage/:appointmentId"
            element={<PublicManageNotImplementedRoute />}
          />
          <Route path="/public/reschedule/:token" element={<PublicRescheduleRoute />} />
          <Route path="*" element={<Navigate to={`/public/${slug}`} replace />} />
        </Routes>
      </BrowserRouter>
    </AppQueryProvider>
  );
}
