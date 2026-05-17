import { db } from '../packages/db/src/index.ts';

const demo = await db.global.tenant.findUniqueOrThrow({ where: { slug: 'demo' } });

const demoClients = await db.forTenant(demo.id).client.findMany();
const otherClients = await db.forTenant('cl-nonexistent-tenant').client.findMany();
const demoPets = await db.forTenant(demo.id).pet.findMany();

console.log(`demo clients: ${demoClients.length}`);
console.log(`other clients: ${otherClients.length}`);
console.log(`demo pets: ${demoPets.length}`);

const ok = demoClients.length === 5 && otherClients.length === 0 && demoPets.length === 8;

await db.global.$disconnect();

if (!ok) {
  console.error('tenant scope verification FAILED');
  process.exit(1);
}
console.log('tenant scope verification OK');
