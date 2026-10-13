import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  PdfViewerComponent, Toolbar, Magnification, Navigation, BookmarkView, Annotation, FormFields, FormDesigner, Inject, DisplayMode,
} from '@syncfusion/ej2-react-pdfviewer';
import { ButtonComponent } from '@syncfusion/ej2-react-buttons';
import { absoluteAssetUrl } from '../../../adapters/basePath';
import { strokeLeavesNoMark } from '../../../adapters/signatureStroke';
import type { FieldValues, SignatureField } from '../../../domain/types';
import { AppLoading } from '../../components/AppLoading';
import { ErrorState } from '../../components/States';

// The viewer lays form fields out in CSS pixels at 96 dpi; the catalogue stores PDF points (72 per inch).
const POINTS_TO_VIEWER = 96 / 72;
const VIEWER_ID = 'receipt-viewer';
// The receipt opens at 125% (user request at prototype approval, 2026-10-11) wherever the viewer is wide enough to
// show the whole page width at that zoom; a narrower viewer keeps its own fit, so a phone never opens on a page
// wider than its screen. The page is 612pt wide.
const OPENING_ZOOM = 125;
const OPENING_ZOOM_MIN_WIDTH = Math.ceil(612 * (96 / 72) * (OPENING_ZOOM / 100)) + 48;
// A file the engine cannot read can end with neither documentLoad nor documentLoadFailed; never spin for ever.
// Long enough for a cold load on a slow connection: the measured fast-3G load of the engine and a document in
// the e-signing portal was about 30 seconds, so a shorter limit would report a failure on a receipt still arriving.
const LOAD_TIMEOUT_MS = 120000;
// The signature can only be drawn: no Type tab, no Upload tab, and no "save signature" box (app-plan.md,
// "Draw-only capture"). The app never judges the drawing.
const DRAW_ONLY = { displayMode: DisplayMode.Draw, hideSaveSignature: true };

interface ViewerField { id?: string; name?: string; value?: string }

// The members used here, as declared in the installed typings (pdfviewer.d.ts, form-designer.d.ts).
interface ViewerInstance {
  retrieveFormFields(): ViewerField[];
  focusFormField(field: unknown): void;
  saveAsBlob(): Promise<Blob>;
  clearFormFields(field?: unknown): void;
  formDesigner?: { addFormField(type: string, options: object): unknown; updateFormField(id: string, options: object): void };
  magnification?: { zoomTo(zoomValue: number): void };
}

export interface DocumentViewerHandle {
  /** Current value of every field, by name. */
  readValues(): FieldValues;
  focusField(name: string): void;
  /** True when the drawing would not appear on the saved receipt (see strokeLeavesNoMark). */
  leavesNoMark(name: string): boolean;
  /** Empties the field (removes the signature) so it can be drawn again. */
  clearField(name: string): void;
  /** The working copy with the signature, as the viewer saves it. */
  save(): Promise<Blob>;
}

interface Props {
  /** Absolute or blob URL of the PDF. */
  url: string;
  /** The signature field to add once the receipt has loaded; null for a read-only review. */
  field: SignatureField | null;
  onReady?(): void;
  onValuesChanged?(): void;
}

/** The PDF Viewer with its loading and failure states (app-source-baseline.md, "Heavy controls"). */
export const DocumentViewer = forwardRef<DocumentViewerHandle, Props>(function DocumentViewer({ url, field, onReady, onValuesChanged }, ref) {
  const viewerRef = useRef<InstanceType<typeof PdfViewerComponent>>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const seeded = useRef(false);

  const instance = useCallback((): ViewerInstance | null => {
    const fromRef = viewerRef.current as unknown as ViewerInstance | null;
    if (fromRef?.retrieveFormFields) return fromRef;
    const el = document.getElementById(VIEWER_ID) as (HTMLElement & { ej2_instances?: ViewerInstance[] }) | null;
    return el?.ej2_instances?.[0] ?? null;
  }, []);

  useImperativeHandle(ref, () => ({
    readValues() {
      const out: Record<string, string> = {};
      // retrieveFormFields() returns the same objects mutated in place, so read values out rather than keep them.
      for (const f of instance()?.retrieveFormFields() ?? []) if (f?.name) out[f.name] = typeof f.value === 'string' ? f.value : '';
      return out;
    },
    focusField(name) {
      const viewer = instance();
      if (!viewer) return;
      viewer.focusFormField(name);
      // The viewer can stop with the field at the bottom edge or below it. Bring it to the middle of the view.
      const id = viewer.retrieveFormFields().find((f) => f?.name === name)?.id;
      if (!id) return;
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let tries = 0;
      const centre = () => {
        const el = document.getElementById(id);
        if (el) { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' }); return; }
        if (++tries < 20) window.setTimeout(centre, 150);
      };
      window.setTimeout(centre, 350);
    },
    leavesNoMark(name) {
      const value = instance()?.retrieveFormFields().find((f) => f?.name === name)?.value;
      return typeof value === 'string' && value.length > 0 && strokeLeavesNoMark(value);
    },
    clearField(name) {
      const viewer = instance();
      const target = viewer?.retrieveFormFields().find((f) => f?.name === name);
      if (viewer && target) viewer.clearFormFields(target); // documented PdfViewer method; needs the Annotation service for signatures
    },
    async save() {
      const viewer = instance();
      if (!viewer) throw new Error('The receipt is not open.');
      // Field borders and fills are editing aids; clear them on the live viewer so they are not baked into the signed copy.
      for (const f of viewer.retrieveFormFields()) {
        if (f?.id) { try { viewer.formDesigner?.updateFormField(f.id, { borderColor: 'transparent', backgroundColor: 'transparent' }); } catch { /* the field is still saved */ } }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const blob = await Promise.resolve(viewer.saveAsBlob());
      if (!blob) throw new Error('The viewer could not export the receipt.');
      return blob;
    },
  }), [instance]);

  const handleLoad = useCallback(() => {
    setState('ready');
    if (!seeded.current) {
      seeded.current = true;
      if (field) {
        const b = field.bounds;
        instance()?.formDesigner?.addFormField('SignatureField', {
          name: field.name,
          pageNumber: field.page, // 1-based; without it the field lands on the page in view
          bounds: { X: b.X * POINTS_TO_VIEWER, Y: b.Y * POINTS_TO_VIEWER, Width: b.Width * POINTS_TO_VIEWER, Height: b.Height * POINTS_TO_VIEWER },
          isRequired: true,
          tooltip: 'Recipient signature (required)',
        });
      }
    }
    const host = document.getElementById(VIEWER_ID);
    if (host && host.clientWidth >= OPENING_ZOOM_MIN_WIDTH) instance()?.magnification?.zoomTo(OPENING_ZOOM); // documented Magnification method
    onReady?.();
    onValuesChanged?.();
  }, [field, instance, onReady, onValuesChanged]);

  useEffect(() => {
    if (state !== 'loading') return;
    const timer = window.setTimeout(() => setState('failed'), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [state, attempt]);

  // Keyboard access to the signature dialog. With a signature field focused, the viewer's own Enter handling opens
  // the dialog without recording which field it is for, and Create then throws ("Cannot read properties of
  // undefined (reading 'name')" in drawSignature, 34.2.8). Enter or Space on a focused, unsigned signature field is
  // therefore turned into the pointer sequence the viewer handles correctly. Drawing itself still needs a pointer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const active = document.activeElement as HTMLElement | null;
      const host = document.getElementById(VIEWER_ID);
      if (!active || !host?.contains(active) || !active.classList.contains('foreign-object')) return;
      const target = active.querySelector<HTMLElement>('.e-pdfviewer-signatureformfields');
      if (!target) return; // not a signature field, or already signed
      event.preventDefault();
      event.stopPropagation();
      const r = target.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: window };
      target.dispatchEvent(new PointerEvent('pointerdown', { ...at, buttons: 1 }));
      target.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 1 }));
      target.dispatchEvent(new PointerEvent('pointerup', at));
      target.dispatchEvent(new MouseEvent('mouseup', at));
      target.dispatchEvent(new MouseEvent('click', at));
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // On failure the viewer is taken down, or its own error dialog would cover the message.
  const handleFailed = useCallback(() => setState('failed'), []);
  const retry = () => { seeded.current = false; setState('loading'); setAttempt((n) => n + 1); };

  if (state === 'failed') {
    return (
      <div className="viewer-area">
        <ErrorState title="We couldn't open this receipt." message="Check your connection and try again.">
          <ButtonComponent cssClass="e-primary" onClick={retry}>Try again</ButtonComponent>
        </ErrorState>
      </div>
    );
  }
  return (
    <div className="viewer-area" data-viewer-state={state}>
      {state === 'loading' && <AppLoading variant="overlay" label="Loading receipt…" />}
      <PdfViewerComponent
        key={attempt}
        ref={viewerRef}
        id={VIEWER_ID}
        documentPath={url}
        resourceUrl={absoluteAssetUrl('ej2-pdfviewer-lib')}
        height="100%"
        // The receipt is one page, so the recipient only needs zoom. The document comes from the app (no Open), and
        // Download is the app's own button: the viewer's would export the unflattened working copy.
        toolbarSettings={{ toolbarItems: ['MagnificationTool'] }}
        contextMenuOption="None"
        enableNavigationToolbar={false}
        enableAnnotationToolbar={false}
        isFormDesignerToolbarVisible={false}
        // Keeps the viewer's working data in memory instead of sessionStorage: the app stores nothing in the browser.
        enableLocalStorage={true}
        hideSaveSignature={true}
        signatureFieldSettings={{ signatureDialogSettings: DRAW_ONLY }}
        handWrittenSignatureSettings={{ signatureDialogSettings: DRAW_ONLY }}
        documentLoad={handleLoad}
        documentLoadFailed={handleFailed}
        formFieldFocusOut={onValuesChanged}
        formFieldPropertiesChange={onValuesChanged}
        addSignature={onValuesChanged}
      >
        {/* BookmarkView has no visible part here (the navigation pane is off), but focusFormField calls into it:
            without it the viewer throws "Cannot read properties of undefined (reading 'goToBookmark')". */}
        <Inject services={[Toolbar, Magnification, Navigation, BookmarkView, Annotation, FormFields, FormDesigner]} />
      </PdfViewerComponent>
    </div>
  );
});
