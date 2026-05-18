import type { GcalEventInput } from '../adapters/gcal/index.js';

export type PushAppointment = {
  id: string;
  tenantId: string;
  scheduledStart: Date;
  durationMin: number;
  serviceNameSnapshot: string;
  notes: string;
  status: string;
  pet: { name: string };
  client: {
    name: string;
    addressStreet: string;
    addressCity: string;
    addressState: string;
    addressZip: string;
  };
  addressOverrideStreet: string | null;
  addressOverrideCity: string | null;
  addressOverrideState: string | null;
  addressOverrideZip: string | null;
};

export function buildEventInput(appt: PushAppointment): GcalEventInput {
  const start = appt.scheduledStart.toISOString();
  const end = new Date(appt.scheduledStart.getTime() + appt.durationMin * 60 * 1000).toISOString();
  const addr = resolveAddressBlock(appt);
  const desc = appt.notes ? `${appt.notes}\n\n${addr}` : addr;
  return {
    summary: `${appt.serviceNameSnapshot} — ${appt.pet.name}`,
    description: desc,
    start,
    end,
    status: 'confirmed',
    extendedProperties: {
      private: {
        mgtAppointmentId: appt.id,
        mgtTenantId: appt.tenantId,
      },
    },
  };
}

function resolveAddressBlock(appt: PushAppointment): string {
  const street = appt.addressOverrideStreet ?? appt.client.addressStreet;
  const city = appt.addressOverrideCity ?? appt.client.addressCity;
  const state = appt.addressOverrideState ?? appt.client.addressState;
  const zip = appt.addressOverrideZip ?? appt.client.addressZip;
  return `${street}, ${city}, ${state} ${zip}`;
}
