import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User, UserRole } from '../models/User';
import { Team } from '../models/Team';
import { Campaign, CampaignStatus } from '../models/Campaign';
import { Project, ProjectStatus, ProjectRole } from '../models/Project';
import { Task, TaskStatus, TaskType } from '../models/Task';

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
    await Team.deleteMany({});
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

    // Create Team
    const team1 = await Team.create({
      name: 'Acme Corp Marketing',
      description: 'Marketing team for Acme Corporation',
      createdBy: admin._id,
      isActive: true
    });

    console.log('✅ Created Team:', team1.name);

    // Create Hybrid User
    const hybrid = await User.create({
      email: 'hybrid@example.com',
      password: 'password123',
      firstName: 'Sarah',
      lastName: 'Johnson',
      role: UserRole.HYBRID,
      teamId: team1._id,
      isActive: true
    });

    console.log('✅ Created Hybrid User:', hybrid.email);

    // Create Campaign
    const campaign = await Campaign.create({
      name: 'Summer Product Launch 2025',
      description: 'Marketing campaign for summer product line launch',
      teamId: team1._id,
      status: CampaignStatus.ACTIVE,
      startDate: new Date('2025-06-01'),
      endDate: new Date('2025-08-31'),
      goals: [
        'Increase brand awareness by 30%',
        'Generate 1000 qualified leads',
        'Achieve 10% conversion rate'
      ],
      createdBy: hybrid._id
    });

    console.log('✅ Created Campaign:', campaign.name);

    // Create Project
    const project = await Project.create({
      name: 'Social Media Campaign',
      description: 'Instagram and Facebook content series for product launch',
      campaignId: campaign._id,
      teamId: team1._id,
      status: ProjectStatus.IN_PROGRESS,
      startDate: new Date('2025-06-01'),
      dueDate: new Date('2025-07-31'),
      createdBy: hybrid._id
    });

    console.log('✅ Created Project:', project.name);

    // Create Tasks
    const task1 = await Task.create({
      name: 'Product Teaser Post',
      description: 'Instagram teaser post announcing the summer collection',
      type: TaskType.POST,
      projectId: project._id,
      campaignId: campaign._id,
      teamId: team1._id,
      status: TaskStatus.IN_PROGRESS,
      scheduledDate: new Date('2025-06-05'),
      publishDate: new Date('2025-06-05'),
      content: 'Check out our stunning new summer collection! 🌞 Coming soon...',
      createdBy: hybrid._id
    });

    const task2 = await Task.create({
      name: 'Launch Day Announcement',
      description: 'Official product launch announcement with carousel images',
      type: TaskType.LAUNCH,
      projectId: project._id,
      campaignId: campaign._id,
      teamId: team1._id,
      status: TaskStatus.PENDING,
      scheduledDate: new Date('2025-06-15'),
      publishDate: new Date('2025-06-15'),
      createdBy: hybrid._id
    });

    console.log('✅ Created Tasks:', task1.name, ',', task2.name);

    console.log('\n✨ Seed data created successfully!\n');
    console.log('📝 Test Credentials:');
    console.log('   System Admin: admin@example.com / password123');
    console.log('   Hybrid User: hybrid@example.com / password123\n');

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seed();
