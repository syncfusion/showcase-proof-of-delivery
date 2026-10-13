import { CheckCircle2, PenLine } from 'lucide-react';

export type Badge = 'awaiting' | 'delivered' | 'signature-required' | 'signed';

const BADGES: Record<Badge, { label: string; tone: string; Icon: typeof PenLine }> = {
  awaiting: { label: 'Awaiting signature', tone: 'info', Icon: PenLine },
  delivered: { label: 'Delivered', tone: 'success', Icon: CheckCircle2 },
  'signature-required': { label: 'Signature required', tone: 'info', Icon: PenLine },
  signed: { label: 'Signed', tone: 'success', Icon: CheckCircle2 },
};

/** Status tone plus an icon and a label, so the meaning never rests on colour alone. */
export function StatusBadge({ badge, label }: { badge: Badge; label?: string }) {
  const { label: fallback, tone, Icon } = BADGES[badge];
  return <span className={`status-badge tone-${tone}`} data-badge={badge}><Icon size={13} aria-hidden="true" />{label ?? fallback}</span>;
}
