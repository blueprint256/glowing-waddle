import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User, UserRole } from '../models/User';
import { Campaign, CampaignStatus } from '../models/Campaign';
import { Project, ProjectStatus } from '../models/Project';
import { Task, TaskStatus } from '../models/Task';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/campaign_management';

async function seed() {
  try {
    // Connect to database
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing data
    console.log('🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Campaign.deleteMany({});
    await Project.deleteMany({});
    await Task.deleteMany({});

    console.log('👤 Creating users...');

    // Create System Admin
    const admin = await User.create({
      email: 'admin@example.com',
      password: 'password123',
      firstName: 'System',
      lastName: 'Administrator',
      role: UserRole.SYSTEM_ADMIN,
      isActive: true
    });

    console.log('✅ Created System Admin:', admin.email);

    // Create Hybrid Users (two different users to test ownership)
    const hybridA = await User.create({
      email: 'hybrid-a@example.com',
      password: 'password123',
      firstName: 'Alice',
      lastName: 'Johnson',
      role: UserRole.HYBRID,
      isActive: true
    });

    const hybridB = await User.create({
      email: 'hybrid-b@example.com',
      password: 'password123',
      firstName: 'Bob',
      lastName: 'Smith',
      role: UserRole.HYBRID,
      isActive: true
    });

    console.log('✅ Created Hybrid Users:', hybridA.email, ',', hybridB.email);

    // Create Campaign for Hybrid User A
    const campaignA = await Campaign.create({
      name: 'Summer Product Launch 2025',
      description: 'Marketing campaign for summer product line launch',
      status: CampaignStatus.ACTIVE,
      startDate: new Date('2025-06-01'),
      endDate: new Date('2025-08-31'),
      goals: [
        'Increase brand awareness by 30%',
        'Generate 1000 qualified leads',
        'Achieve 10% conversion rate'
      ],
      createdBy: hybridA._id
    });

    console.log('✅ Created Campaign for Hybrid A:', campaignA.name);

    // Create Campaign for Hybrid User B
    const campaignB = await Campaign.create({
      name: 'Fall Product Collection 2025',
      description: 'Fall season marketing initiatives',
      status: CampaignStatus.DRAFT,
      startDate: new Date('2025-09-01'),
      endDate: new Date('2025-11-30'),
      goals: [
        'Launch new product line',
        'Increase market share by 15%'
      ],
      createdBy: hybridB._id
    });

    console.log('✅ Created Campaign for Hybrid B:', campaignB.name);

    // Create Campaign for System Admin
    const campaignAdmin = await Campaign.create({
      name: 'Company Rebrand Initiative',
      description: 'Corporate rebranding campaign managed by admin',
      status: CampaignStatus.PLANNING,
      startDate: new Date('2025-12-01'),
      endDate: new Date('2026-02-28'),
      createdBy: admin._id
    });

    console.log('✅ Created Campaign for Admin:', campaignAdmin.name);

    // Create Project for Campaign A
    const project = await Project.create({
      name: 'Social Media Campaign',
      description: 'Instagram and Facebook content series for product launch',
      campaignId: campaignA._id,
      status: ProjectStatus.IN_PROGRESS,
      startDate: new Date('2025-06-01'),
      dueDate: new Date('2025-07-31'),
      createdBy: hybridA._id
    });

    console.log('✅ Created Project:', project.name);

    // Create Tasks
    const task1 = await Task.create({
      name: 'Product Teaser Post',
      description: 'Instagram teaser post announcing the summer collection',
      projectId: project._id,
      campaignId: campaignA._id,
      status: TaskStatus.IN_PROGRESS,
      taskDate: new Date('2025-06-05'),
      content: 'Check out our stunning new summer collection! 🌞 Coming soon...',
      createdBy: hybridA._id
    });

    const task2 = await Task.create({
      name: 'Launch Day Announcement',
      description: 'Official product launch announcement with carousel images',
      projectId: project._id,
      campaignId: campaignA._id,
      status: TaskStatus.PENDING,
      taskDate: new Date('2025-06-15'),
      createdBy: hybridA._id
    });

    console.log('✅ Created Tasks:', task1.name, ',', task2.name);

    console.log('\n✨ Seed data created successfully!\n');
    console.log('📝 Test Credentials:');
    console.log('   System Admin: admin@example.com / password123 (sees ALL campaigns)');
    console.log('   Hybrid User A: hybrid-a@example.com / password123 (sees only their campaigns)');
    console.log('   Hybrid User B: hybrid-b@example.com / password123 (sees only their campaigns)\n');
    console.log('🔍 Ownership Test:');
    console.log('   - Hybrid A owns: "Summer Product Launch 2025"');
    console.log('   - Hybrid B owns: "Fall Product Collection 2025"');
    console.log('   - Admin owns: "Company Rebrand Initiative"');
    console.log('   - System Admin can see all three campaigns');
    console.log('   - Hybrid users can ONLY see their own campaigns\n');

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seed();
