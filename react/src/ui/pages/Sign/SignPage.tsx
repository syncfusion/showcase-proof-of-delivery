import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ButtonComponent } from '@syncfusion/ej2-react-buttons';
import { DialogComponent } from '@syncfusion/ej2-react-popups';
import { ArrowLeft, ArrowRight, Check, Download, Eraser, PackageCheck } from 'lucide-react';
import { useDeliveryStore } from '../../../app/DeliveryStore';
import { absoluteAssetUrl } from '../../../adapters/basePath';
import { browserClock } from '../../../adapters/clock';
import { downloadFile } from '../../../adapters/download';
import { signedCopyFinalizer } from '../../../adapters/pdfFinalizer';
import { parseStroke } from '../../../adapters/signatureStroke';
import { canConfirm, hasSignature, SIGNATURE_REQUIRED_MESSAGE, statusOf } from '../../../domain/rules';
import type { Delivery, FieldValues } from '../../../domain/types';
import { ErrorState } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { useNotify } from '../../components/useNotifier';
import { formatDateTime } from '../../format';
import { DocumentViewer } from './DocumentViewer';
import type { DocumentViewerHandle } from './DocumentViewer';

export function SignPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>();
  const { catalogue, session } = useDeliveryStore();
  if (!catalogue) return null;
  const delivery = catalogue.deliveries.find((d) => d.id === deliveryId);
  if (!delivery) {
    return (
      <div className="page">
        <ErrorState title="Delivery not found." message="It is not on this route.">
          <Link to="/deliveries" className="text-link">Back to deliveries</Link>
        </ErrorState>
      </div>
    );
  }
  // A delivered item opens the same route read-only (app-plan.md): the signed receipt, no field.
  return statusOf(delivery, session) === 'delivered'
    ? <ReviewView key={`review-${delivery.id}`} delivery={delivery} />
    : <SigningView key={`sign-${delivery.id}`} delivery={delivery} />;
}

function Title({ delivery }: { delivery: Delivery }) {
  return <h1><span className="tracking">{delivery.trackingNumber}</span> · {delivery.recipient.name}</h1>;
}

function ReviewView({ delivery }: { delivery: Delivery }) {
  const { delivered } = useDeliveryStore();
  useEffect(() => { document.title = `Receipt ${delivery.trackingNumber} (signed) · Proof of Delivery`; }, [delivery.trackingNumber]);
  // This session's signed copy, or the signed receipt a baseline delivery ships with.
  const entry = delivered(delivery);
  if (!entry) return null;
  return (
    <div className="sign-page" data-mode="review">
      <header className="sign-subheader">
        <Link to="/deliveries" className="sign-back" aria-label="Back to deliveries" title="Back to deliveries"><ArrowLeft size={18} aria-hidden="true" /></Link>
        <div className="sign-titleblock">
          <Title delivery={delivery} />
          <p className="sign-status" data-testid="sign-status">
            <StatusBadge badge="signed" label={`Signed on ${formatDateTime(new Date(entry.signedAt))} · read-only`} />
          </p>
        </div>
        <div className="sign-actions">
          <ButtonComponent cssClass="e-primary" onClick={() => downloadFile(entry.url, entry.fileName)}><Download size={16} aria-hidden="true" />Download</ButtonComponent>
        </div>
      </header>
      <div className="sign-body">
        <div className="viewer-wrap"><DocumentViewer url={entry.url} field={null} /></div>
      </div>
    </div>
  );
}

function SigningView({ delivery }: { delivery: Delivery }) {
  const { completeDelivery } = useDeliveryStore();
  const navigate = useNavigate();
  const notify = useNotify();
  const viewer = useRef<DocumentViewerHandle>(null);
  const [ready, setReady] = useState(false);
  const [values, setValues] = useState<FieldValues>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const field = delivery.signatureField;
  useEffect(() => { document.title = `Sign for ${delivery.trackingNumber} · Proof of Delivery`; }, [delivery.trackingNumber]);

  const refresh = useCallback(() => {
    const next = viewer.current?.readValues();
    if (!next) return;
    // Any drawing is accepted, but one perfectly straight line would be missing from the saved receipt (a viewer
    // defect, see DocumentViewer.strokeLeavesNoMark). It is removed at once and the person is asked to sign again,
    // so a receipt is never completed with an empty signature box.
    if (viewer.current?.leavesNoMark(field.name)) {
      viewer.current.clearField(field.name);
      notify('Please sign again', 'That line was too straight to appear on the receipt. Add a little more to your signature.', 'warning');
      return;
    }
    setValues((prev) => ((prev[field.name] ?? '') === (next[field.name] ?? '') ? prev : next));
  }, [field.name, notify]);
  // The viewer's field events do not fire for every change (a signature added from its dialog, for one),
  // so the field collection is also read on a short interval while the page is open.
  useEffect(() => { const timer = window.setInterval(refresh, 500); return () => window.clearInterval(timer); }, [refresh]);

  const signed = hasSignature(values, field.name);

  // The Next button sits just outside the PDF page's left edge. The viewer centres the page and moves it when the
  // window or the zoom changes, and it reports neither, so the page's position is read on a short interval.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready) return;
    const place = () => {
      const wrap = wrapRef.current;
      const flag = wrap?.querySelector<HTMLElement>('.next-flag');
      const pageEl = wrap?.querySelector<HTMLElement>('[id^="receipt-viewer_pageDiv_"]');
      if (!wrap || !flag || !pageEl) return;
      const gap = 4;
      // Room is judged against the full button, measured while its label is showing.
      if (flag.dataset.beside !== 'viewer') flag.dataset.fullWidth = String(flag.offsetWidth);
      const room = pageEl.getBoundingClientRect().left - wrap.getBoundingClientRect().left - Number(flag.dataset.fullWidth ?? flag.offsetWidth) - gap;
      // No room beside the page (it fills the width): stay at the viewer's own edge, as an arrow only, so the
      // button stays inside the page's margin and off its text. The label remains its accessible name.
      flag.dataset.beside = room >= 0 ? 'page' : 'viewer';
      flag.style.left = `${Math.max(0, Math.round(room))}px`;
    };
    place();
    const timer = window.setInterval(place, 250);
    window.addEventListener('resize', place);
    return () => { window.clearInterval(timer); window.removeEventListener('resize', place); };
  }, [ready, finishing, signed]);
  const clearSignature = () => { viewer.current?.clearField(field.name); window.setTimeout(refresh, 150); };

  const onConfirm = () => {
    refresh();
    const current = viewer.current?.readValues() ?? values;
    // Any drawing is accepted; only an empty field is refused (app-plan.md, "Validation on Confirm delivery").
    if (!canConfirm(current, field.name)) {
      notify(SIGNATURE_REQUIRED_MESSAGE, 'Select the signature box on the receipt and draw your signature.', 'warning');
      viewer.current?.focusField(field.name);
      return;
    }
    setConfirmOpen(true);
  };
  const confirmDelivery = useCallback(async () => {
    setConfirmOpen(false);
    setFinishing(true);
    try {
      const signedAt = browserClock.now();
      // The drawing's points, read before the viewer saves: the delivery slip shows them.
      const signature = parseStroke(viewer.current!.readValues()[field.name] ?? '');
      const saved = await viewer.current!.save();
      const { pdf, watermarked } = await signedCopyFinalizer.finalize(saved, { page: field.page, bounds: field.bounds, signedOn: `Signed on ${formatDateTime(signedAt)}` });
      completeDelivery(delivery, pdf, signedAt, signature);
      navigate(`/confirmed/${delivery.id}`);
      if (!watermarked) notify('Receipt completed without a watermark', 'The watermark image could not be loaded. The signed receipt is complete.', 'warning');
    } catch (error) {
      console.error('The delivery could not be confirmed', error);
      setFinishing(false);
      notify('We couldn\'t confirm the delivery', 'The signature is still on the receipt. Try Confirm delivery again.', 'danger');
    }
  }, [completeDelivery, delivery, field, navigate, notify]);
  const confirmButtons = useMemo(() => [
    { buttonModel: { content: 'Cancel' }, click: () => setConfirmOpen(false) },
    { buttonModel: { content: 'Confirm', isPrimary: true }, click: () => { void confirmDelivery(); } },
  ], [confirmDelivery]);

  return (
    <div className="sign-page" data-mode="sign">
      <header className="sign-subheader">
        <Link to="/deliveries" className="sign-back" aria-label="Back to deliveries" title="Back to deliveries"><ArrowLeft size={18} aria-hidden="true" /></Link>
        <div className="sign-titleblock">
          <Title delivery={delivery} />
          {/* The visible badge is a label, always on screen. Changes are announced from a separate live region, so the
              page never presents a permanent "status" (which also reads as "still loading" to the loading check). */}
          <span className="sr-only" role="status" aria-live="polite">{signed ? 'Signed' : 'Signature required'}</span>
          <p className="sign-status" data-testid="sign-status"><StatusBadge badge={signed ? 'signed' : 'signature-required'} /></p>
        </div>
        <div className="sign-actions">
          {signed && (
            <ButtonComponent cssClass="e-outline" disabled={finishing} onClick={clearSignature}><Eraser size={16} aria-hidden="true" />Clear signature</ButtonComponent>
          )}
          <ButtonComponent cssClass="e-primary" disabled={!ready || finishing} onClick={onConfirm}><PackageCheck size={16} aria-hidden="true" />{finishing ? 'Confirming…' : 'Confirm delivery'}</ButtonComponent>
        </div>
      </header>

      <div className="sign-body">
        <div className="viewer-wrap" ref={wrapRef}>
          {/* The Next button beside the page (app-plan.md, revision 2). It scrolls the signature box to the middle of
              the view; once the receipt is signed it confirms the delivery instead. Before the viewer in the tab order. */}
          {ready && !finishing && (
            signed
              ? <button type="button" className="next-flag finish" onClick={onConfirm} data-testid="next-flag"><Check size={16} aria-hidden="true" /><span className="next-flag-text">Finish</span></button>
              : <button type="button" className="next-flag" onClick={() => viewer.current?.focusField(field.name)} data-testid="next-flag"><ArrowRight size={16} aria-hidden="true" /><span className="next-flag-text">Next</span></button>
          )}
          <DocumentViewer ref={viewer} url={absoluteAssetUrl(delivery.file)} field={field} onReady={() => setReady(true)} onValuesChanged={refresh} />
        </div>
      </div>

      <DialogComponent visible={confirmOpen} isModal header="Confirm delivery?" showCloseIcon closeOnEscape width="min(420px, calc(100vw - 32px))"
        target={document.body} buttons={confirmButtons} close={() => setConfirmOpen(false)} cssClass="app-dialog">
        <p>The receipt becomes read-only. You can view and download the signed receipt afterwards.</p>
      </DialogComponent>
    </div>
  );
}
