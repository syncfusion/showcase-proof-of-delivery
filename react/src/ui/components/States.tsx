import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({ message }: { message: string }) {
  return <div className="state"><Inbox size={28} aria-hidden="true" /><p>{message}</p></div>;
}

/** An error the person can act on: the message, then the actions passed in (Try again, a link back). */
export function ErrorState({ title, message, children }: { title: string; message?: string; children?: ReactNode }) {
  return (
    <div className="state error" role="alert">
      <AlertTriangle size={28} aria-hidden="true" />
      <p className="state-title">{title}</p>
      {message && <p>{message}</p>}
      {children && <div className="state-actions">{children}</div>}
    </div>
  );
}