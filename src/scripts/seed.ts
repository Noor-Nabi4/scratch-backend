import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';

async function main() {
  console.log('🌱 Starting database seed...');

  // Create admin user
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  
  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.admin.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      id: uuidv4(),
      name: 'System Administrator',
      email: adminEmail,
      passwordHash: hashedPassword,
      role: 'ADMIN'
    }
  });

  console.log('✅ Admin user created:', admin.email);

  // Create result types
  const resultTypes = [
    {
      id: uuidv4(),
      name: 'No Prize',
      code: 'NO_PRIZE',
      description: 'Better luck next time!',
      weight: 70,
      stockLimit: null,
      distributedCount: 0,
      isActive: true
    },
    {
      id: uuidv4(),
      name: 'Small Prize',
      code: 'SMALL_PRIZE',
      description: 'Congratulations! You won a small prize.',
      weight: 20,
      stockLimit: 100,
      distributedCount: 0,
      isActive: true
    },
    {
      id: uuidv4(),
      name: 'Medium Prize',
      code: 'MEDIUM_PRIZE',
      description: 'Amazing! You won a medium prize.',
      weight: 8,
      stockLimit: 50,
      distributedCount: 0,
      isActive: true
    },
    {
      id: uuidv4(),
      name: 'Grand Prize',
      code: 'GRAND_PRIZE',
      description: 'Incredible! You won the grand prize!',
      weight: 2,
      stockLimit: 10,
      distributedCount: 0,
      isActive: true
    }
  ];

  for (const resultType of resultTypes) {
    await prisma.resultType.upsert({
      where: { code: resultType.code },
      update: {},
      create: resultType
    });
  }

  console.log('✅ Result types created:', resultTypes.length);

  // Create sample tokens
  const sampleTokens = [];
  for (let i = 1; i <= 100; i++) {
    sampleTokens.push({
      id: uuidv4(),
      code: `SAMPLE${i.toString().padStart(3, '0')}`,
      metadata: { source: 'seed', batch: 'sample' },
      expiresAt: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)) // 30 days
    });
  }

  await prisma.token.createMany({
    data: sampleTokens,
    skipDuplicates: true
  });

  console.log('✅ Sample tokens created:', sampleTokens.length);

  // Create staff user
  const staffPassword = await bcrypt.hash('staff123', 12);
  const staff = await prisma.admin.upsert({
    where: { email: 'staff@example.com' },
    update: {},
    create: {
      id: uuidv4(),
      name: 'Staff Member',
      email: 'staff@example.com',
      passwordHash: staffPassword,
      role: 'STAFF'
    }
  });

  console.log('✅ Staff user created:', staff.email);

  console.log('🎉 Database seed completed successfully!');
  console.log('\n📋 Default credentials:');
  console.log(`Admin: ${adminEmail} / ${adminPassword}`);
  console.log(`Staff: staff@example.com / staff123`);
  console.log('\n🔑 Sample tokens: SAMPLE001, SAMPLE002, SAMPLE003, etc.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

