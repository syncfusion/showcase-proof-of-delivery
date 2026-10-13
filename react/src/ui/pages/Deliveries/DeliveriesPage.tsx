import { useEffect } from 'react';
import { Link } from 'react-router';
import { ButtonComponent } from '@syncfusion/ej2-react-buttons';
import { StepDirective, StepperComponent, StepsDirective } from '@syncfusion/ej2-react-navigations';
import { Check, Download, Eye, PenLine } from 'lucide-react';
import { useDeliveryStore } from '../../../app/DeliveryStore';
import { downloadFile } from '../../../adapters/download';
import { groupByStatus, routeProgress } from '../../../domain/rules';
import type { Delivery } from '../../../domain/types';
import { EmptyState } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../format';

export function DeliveriesPage() {
  const { catalogue, session, openedAt, delivered: deliveredOf } = useDeliveryStore();
  useEffect(() => { document.title = 'Deliveries · Proof of Delivery'; }, []);
  if (!catalogue) return null;
  const { awaiting, delivered } = groupByStatus(catalogue.deliveries, session, openedAt);
  const route = routeProgress(catalogue.deliveries, session);
  const routeName = catalogue.carrier.routeLabel.split(' · ')[0];

  const card = (d: Delivery) => {
    const entry = deliveredOf(d);
    return (
      <li key={d.id}>
        {/* Syncfusion Card markup (CSS only). The whole card opens its delivery: the visible "Sign for delivery" or
            "View receipt" is the card's one link, stretched over its surface (.card-link). "Download" is a different
            action and sits above the link as its own button. Nothing interactive is nested in anything else. */}
        <article className="e-card delivery-item" data-delivery={d.id} data-delivered={entry ? 'true' : 'false'} aria-labelledby={`delivery-${d.id}`}>
          <div className="e-card-header">
            {/* The stop number leads the card; a delivered stop adds a check beside the number, not colour alone. */}
            <span className="delivery-stop" role="img" aria-label={`Stop ${d.stop} on the route${entry ? ', delivered' : ''}`} title={`Stop ${d.stop} on the route`}>
              {entry && <Check size={14} aria-hidden="true" />}{d.stop}
            </span>
            <div className="e-card-header-caption">
              <div className="e-card-header-title" id={`delivery-${d.id}`}>{d.recipient.name}</div>
              <div className="e-card-sub-title">{d.recipient.addressLine1}, {d.recipient.addressLine2}</div>
            </div>
          </div>
          <div className="e-card-content">
            <div className="delivery-meta">
              <StatusBadge badge={entry ? 'delivered' : 'awaiting'} />
              <dl>
                <div><dt>Tracking</dt><dd className="tracking">{d.trackingNumber}</dd></div>
                <div><dt>Service</dt><dd>{d.service}</dd></div>
                <div><dt>Item</dt><dd>{d.item}{d.weight ? `, ${d.weight}` : ''}</dd></div>
                <div><dt>From</dt><dd>{d.sender}</dd></div>
                {entry && <div><dt>Signed</dt><dd>{formatDateTime(new Date(entry.signedAt))}</dd></div>}
              </dl>
            </div>
          </div>
          <div className="e-card-actions">
            <div className="delivery-actions">
              {entry ? (
                <>
                  <Link to={`/sign/${d.id}`} className="e-btn e-outline card-link" aria-label={`View receipt for ${d.recipient.name}`}><Eye size={16} aria-hidden="true" />View receipt</Link>
                  <ButtonComponent cssClass="e-outline card-own-action" onClick={() => downloadFile(entry.url, entry.fileName)} aria-label={`Download receipt for ${d.recipient.name}`}><Download size={16} aria-hidden="true" />Download</ButtonComponent>
                </>
              ) : (
                <Link to={`/sign/${d.id}`} className="e-btn e-primary card-link" aria-label={`Sign for delivery to ${d.recipient.name}`}><PenLine size={16} aria-hidden="true" />Sign for delivery</Link>
              )}
            </div>
          </div>
        </article>
      </li>
    );
  };

  return (
    <div className="page deliveries-page">
      <header className="page-header">
        <div>
          <h1>Deliveries</h1>
          <p data-testid="deliveries-summary">
            {awaiting.length === 0 ? 'Every delivery has been signed for.' : `${awaiting.length} ${awaiting.length === 1 ? 'delivery needs' : 'deliveries need'} a signature.`}
          </p>
        </div>
        <p className="page-note">Sample app: signatures stay in this tab and nothing is sent.</p>
      </header>

      {/* The route: one Stepper step per stop, ticked once that delivery is signed, in whatever order that happens.
          Read-only: it reports progress and is not navigation. The same state is given in words beside it.
          The Stepper works out each step's status from activeStep alone (every step before it completed, every step
          after it not started; stepper.js 34.2.8, navigateToStep), which cannot describe stops signed out of order.
          So no step is active, and each step carries its own indicator: a check for a delivered stop, a location
          pin for one still awaiting, with a class for the tone. */}
      <section className="e-card route-strip" aria-label="Route progress" data-testid="route-strip">
        <div className="e-card-content">
          <p className="route-summary" data-testid="route-summary"><strong>{routeName}</strong><span>{route.delivered} of {route.total} delivered</span></p>
          {/* Remounted when the set of delivered stops changes (signing, Reset), so every step shows its current status. */}
          <StepperComponent key={route.stops.map((s) => (s.delivered ? 1 : 0)).join('')} cssClass="route-stepper" readOnly stepType="Default" labelPosition="Bottom" activeStep={-1}>
            <StepsDirective>
              {route.stops.map((s) => (
                s.delivered
                  ? <StepDirective key={s.id} label={`Stop ${s.stop} · ${s.label}`} iconCss="e-icons e-check" cssClass="route-step-delivered" />
                  : <StepDirective key={s.id} label={`Stop ${s.stop} · ${s.label}`} iconCss="e-icons e-location" cssClass="route-step-awaiting" />
              ))}
            </StepsDirective>
          </StepperComponent>
        </div>
      </section>

      <section aria-labelledby="awaiting-heading" data-testid="awaiting-section">
        <h2 id="awaiting-heading">Awaiting signature <span className="count">{awaiting.length}</span></h2>
        {awaiting.length ? <ul className="delivery-grid">{awaiting.map(card)}</ul> : <EmptyState message="All deliveries are signed for." />}
      </section>

      {/* Not rendered while empty (design/DESIGN.md). */}
      {delivered.length > 0 && (
        <section aria-labelledby="delivered-heading" data-testid="delivered-section">
          <h2 id="delivered-heading">Delivered <span className="count">{delivered.length}</span></h2>
          <ul className="delivery-grid">{delivered.map(card)}</ul>
        </section>
      )}
    </div>
  );
}
