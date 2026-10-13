import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { registerLicense } from '@syncfusion/ej2-base'; // transitive; never add ej2-base to package.json
import './styles/app.css';
import { resolveBasename } from './adapters/basePath';
import { loadCatalogue } from './adapters/catalogue';
import { DeliveryStoreProvider } from './app/DeliveryStore';
import { ThemeProvider } from './ui/theme';
import { App } from './ui/App';

const licenseKey = import.meta.env.VITE_SYNCFUSION_LICENSE_KEY;
if (licenseKey) registerLicense(licenseKey);

// Composition root. No StrictMode: the EJ2 PDF Viewer does imperative DOM setup on mount, and StrictMode's
// development-only double mount breaks it (lesson recorded in app-plan.md from the e-signing portal).
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <DeliveryStoreProvider load={loadCatalogue()}>
      <BrowserRouter basename={resolveBasename()}>
        <App />
      </BrowserRouter>
    </DeliveryStoreProvider>
  </ThemeProvider>,
);
