import type { Appointment, Client } from '@mygroomtime/db';

export type LatLng = { lat: number; lng: number };

export type AppointmentCoordSource = Pick<
  Appointment,
  'addressOverrideLat' | 'addressOverrideLng'
>;

export type ClientCoordSource = Pick<Client, 'addressLat' | 'addressLng'>;

export function resolveAppointmentCoords(
  appt: AppointmentCoordSource,
  client: ClientCoordSource,
): LatLng | null {
  if (
    appt.addressOverrideLat !== null &&
    appt.addressOverrideLat !== undefined &&
    appt.addressOverrideLng !== null &&
    appt.addressOverrideLng !== undefined
  ) {
    return { lat: appt.addressOverrideLat, lng: appt.addressOverrideLng };
  }
  if (
    client.addressLat !== null &&
    client.addressLat !== undefined &&
    client.addressLng !== null &&
    client.addressLng !== undefined
  ) {
    return { lat: client.addressLat, lng: client.addressLng };
  }
  return null;
}

export function coordsKey(c: LatLng): string {
  return `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
}
