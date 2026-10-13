import { useEffect } from 'react';
import { useDeliveryStore } from '../../../app/DeliveryStore';
import { resolveBasename } from '../../../adapters/basePath';

const PAGE_LOADED = new Date(performance.timeOrigin).toISOString();

/** Page-level health view (factory/standards/health-check.md), outside the shell. The host serves its own JSON
 *  /healthz at its root. This app has no backend, so there is no API section: the page loading at all shows the
 *  static bundle is being served, and the catalogue line shows the JSON source validated. */
export function HealthPage() {
  const { load } = useDeliveryStore();
  useEffect(() => { document.title = 'Health · Proof of Delivery'; }, []);
  return (
    <main className="healthz" aria-labelledby="healthz-title">
      <h1 id="healthz-title">Health</h1>
      <dl>
        <dt>Status</dt><dd data-testid="health-status" className={load.ok ? 'tone-success' : 'tone-danger'}>{load.ok ? 'ok' : 'degraded'}</dd>
        <dt>App</dt><dd data-testid="health-app">{__APP_NAME__}</dd>
        <dt>Version</dt><dd data-testid="health-version">{__APP_VERSION__}</dd>
        <dt>Built</dt><dd>{__BUILD_TIME__}</dd>
        <dt>Page loaded</dt><dd>{PAGE_LOADED}</dd>
        <dt>Base path</dt><dd>{resolveBasename()}</dd>
        <dt>Data source</dt><dd>json (no backend)</dd>
        <dt>Fixture version</dt><dd>{load.ok ? load.catalogue.fixtureVersion : 'not loaded'}</dd>
        <dt>Deliveries</dt><dd>{load.ok ? load.catalogue.deliveries.length : 0}</dd>
        {!load.ok && (<><dt>Catalogue errors</dt><dd>{load.errors.join(' ')}</dd></>)}
      </dl>
    </main>
  );
}
