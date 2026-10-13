import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Shell } from './shell/Shell';
import { AppLoading } from './components/AppLoading';
import { useTheme } from './theme';
import { HealthPage } from './pages/Health/HealthPage';

// Pages load on demand: the PDF Viewer's library is only downloaded on the signing route.
const DeliveriesPage = lazy(() => import('./pages/Deliveries/DeliveriesPage').then((m) => ({ default: m.DeliveriesPage })));
const SignPage = lazy(() => import('./pages/Sign/SignPage').then((m) => ({ default: m.SignPage })));
const ConfirmedPage = lazy(() => import('./pages/Confirmed/ConfirmedPage').then((m) => ({ default: m.ConfirmedPage })));

const page = (name: string, el: ReactNode) => <Suspense fallback={<AppLoading label={`Loading ${name}…`} />}>{el}</Suspense>;

export function App() {
  const { ready } = useTheme();
  const { pathname } = useLocation();
  return (
    <>
      {/* Startup screen until the Syncfusion theme has loaded; the shell mounts underneath so page code downloads meanwhile. */}
      {!ready && pathname !== '/healthz' && <AppLoading variant="screen" label="Loading Proof of Delivery…" />}
      <Routes>
        {/* Standalone status page, outside the shell (factory/standards/health-check.md). */}
        <Route path="/healthz" element={<HealthPage />} />
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/deliveries" replace />} />
          <Route path="/deliveries" element={page('Deliveries', <DeliveriesPage />)} />
          <Route path="/sign/:deliveryId" element={page('Sign for Delivery', <SignPage />)} />
          <Route path="/confirmed/:deliveryId" element={page('Delivery Confirmed', <ConfirmedPage />)} />
          <Route path="*" element={<Navigate to="/deliveries" replace />} />
        </Route>
      </Routes>
    </>
  );
}
