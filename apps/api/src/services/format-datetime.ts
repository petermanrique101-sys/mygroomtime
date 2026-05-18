// why: SMS confirmation, SMS reminders, and email confirmations all need the same human
// rendering of an appointment start — "Monday, May 20 at 10:00 AM". Single helper so the
// format never drifts between touchpoints.
export function formatAppointmentDateTime(d: Date): string {
  const date = d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} at ${time}`;
}
