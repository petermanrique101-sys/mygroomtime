import { PrismaClient, AppointmentStatus, CoatType, PlanTier, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_SLUG = 'demo';

const services = [
  { name: 'Full Groom', durationMin: 90, basePriceCents: 8500, depositCents: 2000, color: '#2563eb' },
  { name: 'Bath & Brush', durationMin: 60, basePriceCents: 5000, depositCents: 1000, color: '#16a34a' },
  { name: 'Nail Trim', durationMin: 15, basePriceCents: 2000, depositCents: 0, color: '#f59e0b' },
];

const clients = [
  {
    name: 'Sarah Johnson',
    phone: '+19725550101',
    email: 'sarah.j@example.com',
    addressStreet: '3201 Coit Rd',
    addressZip: '75093',
    addressLat: 33.0357,
    addressLng: -96.7894,
    pets: [
      { name: 'Buddy', breed: 'Golden Retriever', weightLb: 65, coatType: CoatType.long },
      { name: 'Daisy', breed: 'Cocker Spaniel', weightLb: 28, coatType: CoatType.curly },
    ],
  },
  {
    name: 'Michael Chen',
    phone: '+19725550102',
    email: 'mchen@example.com',
    addressStreet: '5800 Legacy Dr',
    addressZip: '75024',
    addressLat: 33.0815,
    addressLng: -96.8203,
    pets: [{ name: 'Mochi', breed: 'Shiba Inu', weightLb: 22, coatType: CoatType.double }],
  },
  {
    name: 'Jessica Martinez',
    phone: '+19725550103',
    email: null,
    addressStreet: '1900 Preston Rd',
    addressZip: '75093',
    addressLat: 33.0492,
    addressLng: -96.8019,
    pets: [
      { name: 'Rocky', breed: 'Pit Bull Mix', weightLb: 55, coatType: CoatType.short },
      { name: 'Luna', breed: 'Border Collie', weightLb: 40, coatType: CoatType.medium },
    ],
  },
  {
    name: 'David Patel',
    phone: '+19725550104',
    email: 'dpatel@example.com',
    addressStreet: '7700 Windhaven Pkwy',
    addressZip: '75093',
    addressLat: 33.0668,
    addressLng: -96.8442,
    pets: [{ name: 'Cooper', breed: 'Labradoodle', weightLb: 60, coatType: CoatType.curly }],
  },
  {
    name: 'Emily Rodriguez',
    phone: '+19725550105',
    email: 'emily.r@example.com',
    addressStreet: '4500 Communications Pkwy',
    addressZip: '75093',
    addressLat: 33.0561,
    addressLng: -96.8128,
    pets: [
      { name: 'Bella', breed: 'Yorkie', weightLb: 8, coatType: CoatType.long },
      { name: 'Max', breed: 'Schnauzer', weightLb: 18, coatType: CoatType.wire },
    ],
  },
];

async function seed(): Promise<void> {
  const existing = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing) {
    await prisma.tenant.delete({ where: { id: existing.id } });
  }

  const tenant = await prisma.tenant.create({
    data: {
      slug: DEMO_SLUG,
      businessName: 'Plano Pup Spa',
      phone: '+19725550199',
      // why: pro tier so the public booking page (chunk 11+) renders locally on demo.localhost.
      plan: PlanTier.pro,
      defaultServiceAreaZips: ['75093', '75024', '75025'],
      depotAddressStreet: '6101 Windhaven Pkwy',
      depotAddressCity: 'Plano',
      depotAddressZip: '75093',
      depotLat: 33.0641,
      depotLng: -96.8377,
    },
  });

  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'owner@demo.test',
      // why: auth lands in chunk 3; this is a structurally valid argon2id string but a
      // deliberate placeholder — never resolves to a real password.
      hashedPassword:
        '$argon2id$v=19$m=65536,t=3,p=4$cGxhY2Vob2xkZXJzYWx0$cGxhY2Vob2xkZXJoYXNoZGlnZXN0',
      role: UserRole.owner,
      name: 'Demo Owner',
    },
  });

  await prisma.service.createMany({
    data: services.map((s) => ({ ...s, tenantId: tenant.id })),
  });

  for (const client of clients) {
    await prisma.client.create({
      data: {
        tenantId: tenant.id,
        name: client.name,
        phone: client.phone,
        email: client.email,
        addressStreet: client.addressStreet,
        addressCity: 'Plano',
        addressZip: client.addressZip,
        addressLat: client.addressLat,
        addressLng: client.addressLng,
        addressVerified: true,
        pets: {
          create: client.pets.map((p) => ({
            tenantId: tenant.id,
            name: p.name,
            breed: p.breed,
            weightLb: p.weightLb,
            coatType: p.coatType,
          })),
        },
      },
    });
  }

  const vehicle = await prisma.vehicle.create({
    data: { tenantId: tenant.id, name: 'Van 1' },
  });

  const owner = await prisma.user.findFirst({
    where: { tenantId: tenant.id },
    select: { id: true },
  });
  const servicesById = await prisma.service.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, durationMin: true, basePriceCents: true, depositCents: true, color: true },
  });
  const fullGroom = servicesById.find((s) => s.name === 'Full Groom');
  const bathBrush = servicesById.find((s) => s.name === 'Bath & Brush');
  const nailTrim = servicesById.find((s) => s.name === 'Nail Trim');
  const tenantPets = await prisma.pet.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, clientId: true },
  });
  const buddy = tenantPets.find((p) => p.name === 'Buddy');
  const mochi = tenantPets.find((p) => p.name === 'Mochi');
  const rocky = tenantPets.find((p) => p.name === 'Rocky');

  function dateAt(daysFromToday: number, hour: number, minute = 0): Date {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  const seedAppointments = [
    { pet: buddy, service: fullGroom, when: dateAt(0, 9, 0) },
    { pet: mochi, service: bathBrush, when: dateAt(0, 13, 0) },
    { pet: rocky, service: nailTrim, when: dateAt(1, 10, 30) },
  ];

  for (const a of seedAppointments) {
    if (!a.pet || !a.service || !owner) continue;
    await prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        clientId: a.pet.clientId,
        petId: a.pet.id,
        serviceId: a.service.id,
        vehicleId: vehicle.id,
        groomerId: owner.id,
        status: AppointmentStatus.scheduled,
        scheduledStart: a.when,
        durationMin: a.service.durationMin,
        serviceNameSnapshot: a.service.name,
        servicePriceCentsSnapshot: a.service.basePriceCents,
        serviceDepositCentsSnapshot: a.service.depositCents,
        serviceColorSnapshot: a.service.color,
        serviceDurationMinSnapshot: a.service.durationMin,
      },
    });
  }

  const counts = {
    services: await prisma.service.count({ where: { tenantId: tenant.id } }),
    clients: await prisma.client.count({ where: { tenantId: tenant.id } }),
    pets: await prisma.pet.count({ where: { tenantId: tenant.id } }),
    appointments: await prisma.appointment.count({ where: { tenantId: tenant.id } }),
  };

  console.log(
    `Seed complete: tenant=${tenant.id} services=${counts.services} clients=${counts.clients} pets=${counts.pets} appts=${counts.appointments}`,
  );
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
