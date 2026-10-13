import { useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { AppBarComponent } from '@syncfusion/ej2-react-navigations';
import { ButtonComponent } from '@syncfusion/ej2-react-buttons';
import { DialogComponent } from '@syncfusion/ej2-react-popups';
import { Moon, PackageCheck, RotateCcw, Sun } from 'lucide-react';
import { useDeliveryStore } from '../../app/DeliveryStore';
import { useTheme } from '../theme';
import { NotifierProvider, useNotify } from '../components/useNotifier';
import { ErrorState } from '../components/States';

export function Shell() {
  return <NotifierProvider><ShellFrame /></NotifierProvider>;
}

function ShellFrame() {
  const { load, catalogue, reset } = useDeliveryStore();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const notify = useNotify();
  const [resetOpen, setResetOpen] = useState(false);

  const confirmReset = useCallback(() => {
    setResetOpen(false);
    reset();
    navigate('/deliveries');
    notify('Demo reset', 'Every delivery is waiting for a signature again.', 'info');
  }, [reset, navigate, notify]);
  const resetButtons = useMemo(() => [
    { buttonModel: { content: 'Cancel' }, click: () => setResetOpen(false) },
    { buttonModel: { content: 'Reset demo', isPrimary: true }, click: confirmReset },
  ], [confirmReset]);

  return (
    <div className="app-frame">
      {/* No profile and no sign-in control: the app has no login (app-plan.md). */}
      <AppBarComponent colorMode="Inherit" cssClass="app-topbar">
        <Link to="/deliveries" className="app-brand" aria-label="Proof of Delivery, deliveries">
          <span className="app-brand-mark" aria-hidden="true"><PackageCheck size={18} /></span>
          <span className="app-brand-name">Proof of Delivery</span>
        </Link>
        {catalogue && <span className="app-route-label">{catalogue.carrier.name} · {catalogue.carrier.routeLabel.split(' · ')[0]}</span>}
        <div className="e-appbar-spacer" />
        <ButtonComponent cssClass="e-outline app-reset" disabled={!load.ok} onClick={() => setResetOpen(true)} title="Return every delivery to awaiting signature" aria-label="Reset demo">
          <RotateCcw size={16} aria-hidden="true" /><span className="btn-text">Reset demo</span>
        </ButtonComponent>
        <button type="button" className="app-icon-button" onClick={toggle} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
        </button>
      </AppBarComponent>

      <main className="app-main">
        {load.ok ? <Outlet /> : (
          <ErrorState title="We couldn't load the deliveries." message="The delivery list is not in the expected format.">
            <ButtonComponent cssClass="e-primary" onClick={() => window.location.reload()}>Reload</ButtonComponent>
          </ErrorState>
        )}
      </main>

      <DialogComponent visible={resetOpen} isModal header="Reset demo?" showCloseIcon closeOnEscape width="min(420px, calc(100vw - 32px))"
        target={document.body} buttons={resetButtons} close={() => setResetOpen(false)} cssClass="app-dialog">
        <p>Signed receipts in this tab are discarded, and every delivery waits for a signature again.</p>
      </DialogComponent>
    </div>
  );
}
