// en-US display formatting in the visitor's local time (design/DESIGN.md).
const DATE_TIME = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

export const formatDateTime = (d: Date) => DATE_TIME.format(d);
