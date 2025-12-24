import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User, UserRole } from '../models/User';
import { Team } from '../models/Team';
import { Campaign, CampaignStatus } from '../models/Campaign';
import { Project, ProjectStatus, ProjectRole } from '../models/Project';
import { Event, EventStatus, EventType } from '../models/Event';

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
    await Event.deleteMany({});

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

    // Create Marketer
    const marketer = await User.create({
      email: 'marketer@example.com',
      password: 'password123',
      firstName: 'John',
      lastName: 'Smith',
      role: UserRole.MARKETER,
      teamId: team1._id,
      isActive: true
    });

    // Create Designer
    const designer = await User.create({
      email: 'designer@example.com',
      password: 'password123',
      firstName: 'Emily',
      lastName: 'Chen',
      role: UserRole.DESIGNER,
      teamId: team1._id,
      isActive: true
    });

    // Create Client
    const client = await User.create({
      email: 'client@example.com',
      password: 'password123',
      firstName: 'Michael',
      lastName: 'Brown',
      role: UserRole.CLIENT,
      teamId: team1._id,
      isActive: true
    });

    console.log('✅ Created Users: Hybrid, Marketer, Designer, Client');

    // Create Campaign
    const campaign = await Campaign.create({
      name: 'Summer Product Launch 2025',
      description: 'Marketing campaign for summer product line launch',
      teamId: team1._id,
      status: CampaignStatus.ACTIVE,
      startDate: new Date('2025-06-01'),
      endDate: new Date('2025-08-31'),
      budget: 50000,
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
      createdBy: hybrid._id,
      assignments: [
        {
          userId: marketer._id,
          role: ProjectRole.PROJECT_MANAGER,
          assignedBy: hybrid._id,
          assignedAt: new Date()
        },
        {
          userId: designer._id,
          role: ProjectRole.PROJECT_DESIGNER,
          assignedBy: hybrid._id,
          assignedAt: new Date()
        }
      ]
    });

    console.log('✅ Created Project:', project.name);

    // Create Events
    const event1 = await Event.create({
      name: 'Product Teaser Post',
      description: 'Instagram teaser post announcing the summer collection',
      type: EventType.POST,
      projectId: project._id,
      campaignId: campaign._id,
      teamId: team1._id,
      status: EventStatus.IN_PROGRESS,
      scheduledDate: new Date('2025-06-05'),
      assignedTo: designer._id,
      content: 'Check out our stunning new summer collection! 🌞 Coming soon...',
      createdBy: marketer._id
    });

    const event2 = await Event.create({
      name: 'Launch Day Announcement',
      description: 'Official product launch announcement with carousel images',
      type: EventType.LAUNCH,
      projectId: project._id,
      campaignId: campaign._id,
      teamId: team1._id,
      status: EventStatus.DRAFT,
      scheduledDate: new Date('2025-06-15'),
      assignedTo: designer._id,
      createdBy: marketer._id
    });

    console.log('✅ Created Events:', event1.name, ',', event2.name);

    console.log('\n✨ Seed data created successfully!\n');
    console.log('📝 Test Credentials:');
    console.log('   System Admin: admin@example.com / password123');
    console.log('   Hybrid User: hybrid@example.com / password123');
    console.log('   Marketer: marketer@example.com / password123');
    console.log('   Designer: designer@example.com / password123');
    console.log('   Client: client@example.com / password123\n');

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seed();
