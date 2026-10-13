import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastComponent } from '@syncfusion/ej2-react-notifications';
import { useReducedMotion } from '../useMediaQuery';

export type Notify = (title: string, content: string, kind: 'success' | 'warning' | 'danger' | 'info') => void;
const Ctx = createContext<Notify>(() => {});
export const useNotify = () => useContext(Ctx);

/** One Toast for the whole app, rendered by the shell; every message is mirrored to a polite live region. */
export function NotifierProvider({ children }: { children: ReactNode }) {
  const toast = useRef<ToastComponent>(null);
  const [live, setLive] = useState('');
  const reduced = useReducedMotion();
  const notify = useCallback<Notify>((title, content, kind) => {
    toast.current?.show({ title, content, cssClass: `e-toast-${kind}`, timeOut: kind === 'danger' || kind === 'warning' ? 6000 : 4000 });
    setLive(`${title}. ${content}`);
  }, []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      {/* The Toast relocates its own element, so it sits in a wrapper React owns. */}
      <div className="toast-host">
        <ToastComponent ref={toast} position={{ X: 'Right', Y: 'Top' }} showCloseButton newestOnTop
          animation={reduced ? { show: { effect: 'FadeIn', duration: 0 }, hide: { effect: 'FadeOut', duration: 0 } } : undefined} />
      </div>
      <div className="sr-only" role="status" aria-live="polite">{live}</div>
    </Ctx.Provider>
  );
}