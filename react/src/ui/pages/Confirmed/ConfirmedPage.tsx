import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ButtonComponent } from '@syncfusion/ej2-react-buttons';
import { CircleCheck, Download, Eye } from 'lucide-react';
import { useDeliveryStore } from '../../../app/DeliveryStore';
import { downloadFile } from '../../../adapters/download';
import { strokeSvg } from '../../../adapters/signatureStroke';
import { formatDateTime } from '../../format';

/** The confirmation as a delivery slip: carrier strip, "Delivered", the facts, and the signature the person drew. */
export function ConfirmedPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>();
  const { catalogue, session } = useDeliveryStore();
  const navigate = useNavigate();
  useEffect(() => { document.title = 'Delivery Confirmed · Proof of Delivery'; }, []);

  const delivery = catalogue?.deliveries.find((d) => d.id === deliveryId);
  const entry = delivery ? session[delivery.id] : undefined;
  // This screen follows a signing in this session; anything else goes back to the list.
  if (!catalogue || !delivery || !entry) return <Navigate to="/deliveries" replace />;
  const drawing = strokeSvg(entry.signature);

  return (
    <div className="page confirmed-page">
      <section className="e-card confirmed-panel delivery-slip" aria-labelledby="confirmed-title">
        <div className="slip-strip">
          <span className="slip-carrier">{catalogue.carrier.name}</span>
          <span className="slip-tracking tracking" data-testid="slip-tracking">{delivery.trackingNumber}</span>
        </div>
        <div className="e-card-header">
          <span className="confirmed-icon" aria-hidden="true"><CircleCheck size={28} /></span>
          <div className="e-card-header-caption">
            <h1 className="e-card-header-title" id="confirmed-title">Delivered</h1>
            <div className="e-card-sub-title">Thank you. The signed receipt is ready to view or download.</div>
          </div>
        </div>
        <div className="e-card-content">
          <dl className="confirmed-facts">
            <div><dt>Recipient</dt><dd data-testid="confirmed-recipient">{delivery.recipient.name}</dd></div>
            <div><dt>Address</dt><dd>{delivery.recipient.addressLine1}, {delivery.recipient.addressLine2}</dd></div>
            <div><dt>Item</dt><dd>{delivery.item}{delivery.weight ? `, ${delivery.weight}` : ''}</dd></div>
            <div><dt>Signed</dt><dd>{formatDateTime(new Date(entry.signedAt))}</dd></div>
          </dl>
          {/* The drawing itself, from the points the signature dialog produced. Left out when there are none. */}
          {drawing && (
            <figure className="slip-signature" data-testid="slip-signature" data-points={entry.signature.length}>
              <figcaption>Signature</figcaption>
              <svg viewBox={drawing.viewBox} role="img" aria-label="Signature drawn by the recipient" preserveAspectRatio="xMidYMid meet">
                <path d={drawing.d} />
              </svg>
            </figure>
          )}
          <div className="confirmed-note">The signed receipt is read-only.</div>
        </div>
        <div className="e-card-actions">
          <div className="confirmed-actions">
            <ButtonComponent cssClass="e-outline" onClick={() => navigate(`/sign/${delivery.id}`)}><Eye size={16} aria-hidden="true" />View signed receipt</ButtonComponent>
            <ButtonComponent cssClass="e-primary" onClick={() => downloadFile(entry.signedUrl, entry.fileName)}><Download size={16} aria-hidden="true" />Download receipt</ButtonComponent>
            <ButtonComponent cssClass="e-flat" onClick={() => navigate('/deliveries')}>Back to deliveries</ButtonComponent>
          </div>
        </div>
      </section>
    </div>
  );
}
