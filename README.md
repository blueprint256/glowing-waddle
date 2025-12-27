# Campaign Management Platform

A full-stack collaborative campaign management and content production platform with role-based access control, hierarchical project organization, and comprehensive approval workflows.

## Recent Updates (2025)

### Simplified Role System
- **Reduced from 5 roles to 2 roles**: System Admin and Hybrid
- System Admin: Full platform access including user management
- Hybrid: Campaign, project, and task management capabilities
- Removed: Client, Marketer, and Designer roles
- **Teams feature fully removed**: Access controlled purely by role and ownership

### Task Management
- **Task management** with designed image upload and S3 integration
- Added **publish date** field for task scheduling
- Enhanced **status management** with dropdown (Pending, In Progress, Completed)

### New Features
- **Details Sheet**: New hierarchical view showing all campaigns, projects, and tasks in a single collapsible accordion interface with:
  - Campaign progress tracking
  - Project summaries
  - Comprehensive task tables with photo counts, notes, and last updated timestamps
  - Progressive data loading for performance

### Navigation Updates
- Removed Teams navigation link
- Added Details Sheet to main navigation
- Streamlined UI focused on campaign and task management

## Architecture Overview

### Tech Stack

**Backend:**
- Node.js with Express.js
- MongoDB with Mongoose (ODM)
- Passport.js with LocalStrategy (session-based authentication)
- express-session with MongoDB store
- TypeScript

**Frontend:**
- React 18 with TypeScript
- Material-UI (MUI) for components
- Zustand for state management
- React Router v6 for navigation
- Vite for build tooling

**Key Features:**
- Hierarchical structure: Campaigns → Projects → Tasks
- 2 user roles with granular permissions (System Admin, Hybrid)
- RBAC enforcement at API and UI levels
- Role and ownership-based access control
- Task management with image uploads and scheduling
- Comments and collaboration
- Asset management with S3 file storage
- Details Sheet for comprehensive campaign overview
- Audit logging for all critical actions
- Rate limiting and security headers

---

## Hierarchy & Data Model

```
Campaign
 └─ Project
     └─ Task
         ├─ Comments
         └─ Assets
```

**Key Relationships:**
- Campaigns are owned by Users (createdBy)
- Projects belong to Campaigns
- Tasks belong to Projects
- Project Assignments link Users to Projects with roles
- Access controlled by role (System Admin vs. Hybrid) and ownership

---

## User Roles & Permissions

### 1. System Administrator
- Full platform access
- Create/manage users
- Override all restrictions
- Access audit logs
- Manage all campaigns, projects, and tasks

### 2. Hybrid User
- Manage campaigns, projects, and tasks
- Assign users to projects
- Upload task images and assets
- Manage task scheduling and status
- **Cannot** create users

---

## Setup Instructions

### Prerequisites

- Node.js 18+ and npm
- MongoDB 4.4+ (running locally or via Docker)
- Git

### 1. Clone the Repository

```bash
git clone <repository-url>
cd glowing-waddle
```

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your configuration
# Default MongoDB URI: mongodb://localhost:27017/campaign_management
# Generate a strong SESSION_SECRET for production

# Build TypeScript
npm run build

# Seed database with demo data
npm run seed
```

**Seed Data Creates:**
- System Admin: `admin@example.com / password123`
- Hybrid User: `hybrid@example.com / password123`
- Sample campaign, project, and tasks

### 3. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# (Optional) Edit VITE_API_URL if backend is not on localhost:5000
```

### 4. Running the Application

**Option A: Run both servers separately**

Terminal 1 (Backend):
```bash
cd backend
npm run dev
# Server runs on http://localhost:5000
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
# Frontend runs on http://localhost:3000
```

**Option B: Production build**

Backend:
```bash
cd backend
npm run build
npm start
```

Frontend:
```bash
cd frontend
npm run build
npm run preview
```

### 5. Access the Application

Open http://localhost:3000 in your browser.

**Login with demo credentials:**
- System Admin: `admin@example.com / password123`
- Hybrid User: `hybrid@example.com / password123`

---

## Demo Workflow

### Scenario: Creating a Campaign End-to-End

1. **Login as System Admin**
   - Navigate to Users → Create Hybrid users as needed

2. **Create Campaign**
   - Navigate to Campaigns → Create New Campaign
   - Enter: Name, Description, Goals
   - Campaign created (status: Draft)

3. **Create Project**
   - Open campaign → New Project
   - Enter: Name, Description, Dates
   - Assign Hybrid users to project

4. **Create Tasks**
   - Open project → New Task
   - Enter: Name, Description
   - Set scheduled date and publish date
   - Task created (status: Pending)

5. **Work on Task**
   - Open task → Edit content
   - Upload designed image
   - Update status to "In Progress"
   - Add task description and notes

6. **Complete Task**
   - Review task details
   - Ensure image is uploaded
   - Update status to "Completed"
   - Set final publish date

7. **View Progress**
   - Navigate to Details Sheet
   - View hierarchical campaign → project → task overview
   - Monitor campaign progress bar
   - Review task status and photo counts

8. **Collaboration**
   - Users add comments on tasks, projects, and campaigns
   - Track changes via audit log (Admin only)

---

## Assignment Authority Matrix

The system enforces strict rules for who can assign users to projects:

| Assigning Role | Can Assign Users | Can Manage Users |
|----------------|------------------|------------------|
| System Admin   | ✅ Yes           | ✅ Yes           |
| Hybrid         | ✅ Yes           | ❌ No            |

**Key Rules:**
- Only System Admin can create and manage users
- Both roles can assign users to projects
- Both roles can manage campaigns, projects, and tasks
- Access controlled by role and ownership (createdBy)

---

## API Documentation

### Authentication Endpoints

- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Logout current session
- `GET /api/auth/me` - Get current user

### Resource Endpoints

- `/api/users` - User CRUD (System Admin only)
- `/api/campaigns` - Campaign management
- `/api/projects` - Project management
  - `POST /api/projects/:id/assignments` - Assign user to project
- `/api/tasks` - Task management
  - `POST /api/tasks/:id/upload-image` - Upload designed image to task
- `/api/comments` - Comments on tasks/projects/campaigns
- `/api/assets` - File uploads and downloads (S3 integration)

All endpoints require authentication except `/api/auth/login`.

---

## Security Features

✅ **Implemented:**
- Session-based authentication with secure cookies
- Password hashing with bcrypt
- RBAC middleware on all protected routes
- Input validation using express-validator
- Rate limiting (100 requests per 15 min)
- Helmet.js for security headers
- CORS configuration
- Audit logging for sensitive actions

🔄 **Production Recommendations:**
- Use HTTPS (set secure cookies)
- Implement CSRF protection
- Add email verification
- Configure MongoDB authentication
- Use environment-based secrets management
- Implement backup/recovery strategy

---

## Testing

### Manual Testing

Use the seeded demo accounts to test each role:

**System Admin:**
- Create and manage users
- Override permissions
- View audit logs
- Manage all campaigns, projects, and tasks

**Hybrid User:**
- Create campaigns and projects
- Create and manage tasks
- Upload task images
- Set task scheduling and status
- Assign users to projects
- View Details Sheet for comprehensive overview

### Automated Testing (Future)

Add unit tests for:
- RBAC middleware functions
- Assignment authority validation
- Task image upload validation

Integration tests for:
- Complete campaign creation workflow
- Project assignment flow
- Task creation and status management
- Details Sheet data loading

---

## File Structure

```
.
├── backend/
│   ├── src/
│   │   ├── config/         # Database, Passport config
│   │   ├── middleware/     # Auth, RBAC, validation
│   │   ├── models/         # Mongoose schemas
│   │   ├── routes/         # Express routes
│   │   ├── scripts/        # Seed script
│   │   ├── utils/          # Audit logger
│   │   └── server.ts       # Entry point
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── pages/          # Route pages
│   │   │   ├── Tasks/      # Task management pages
│   │   │   ├── Projects/   # Project management pages
│   │   │   ├── Campaigns/  # Campaign management pages
│   │   │   └── DetailsSheet.tsx  # Hierarchical overview
│   │   ├── services/       # API client
│   │   ├── store/          # Zustand stores
│   │   ├── types/          # TypeScript types
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

---

## Known Limitations & Future Enhancements

### Current Limitations (Prototype)

1. **AWS S3 Configuration Required**: Task image uploads require AWS S3 credentials in environment variables
2. **No Email Notifications**: Mentions don't send emails
3. **Basic Analytics**: Limited to simple counts in Details Sheet; add charts and metrics
4. **No Real-time Updates**: Refresh required; add WebSocket support
5. **Limited Validation**: Basic validation; enhance with comprehensive rules
6. **No Undo/Versioning**: Content changes are not versioned

### Future Enhancements

- [ ] Calendar view for scheduled tasks
- [ ] Drag-and-drop Kanban boards for task management
- [ ] Advanced search and filtering in Details Sheet
- [ ] Export reports (PDF/CSV) from Details Sheet
- [ ] Mobile app (React Native)
- [ ] Integration with social media platforms for task publishing
- [ ] Automated workflows and triggers
- [ ] Multi-language support
- [ ] Dark mode theme
- [ ] Real-time collaboration features

---

## Assumptions & Design Decisions

1. **Session-based Auth**: Chose sessions over JWT for simplicity and server-side control
2. **MongoDB**: Selected for flexible schema and hierarchical data modeling
3. **Two-Role System**: Simplified from 5 roles to System Admin and Hybrid for clearer permissions
4. **AWS S3 Integration**: Task images stored in S3 for scalability and reliability
5. **Role-Based Access**: Access controlled by user role and ownership (createdBy) without teams
6. **Soft Deletes**: Users marked inactive rather than hard deleted
7. **Progressive Data Loading**: Details Sheet loads data on-demand for performance
8. **No Email Verification**: Demo purposes only; add in production
9. **Password Requirements**: Minimum 6 characters (increase in production)

---

## Troubleshooting

**MongoDB Connection Error:**
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```
Solution: Ensure MongoDB is running (`mongod` or via Docker)

**Port Already in Use:**
```
Error: listen EADDRINUSE: address already in use :::5000
```
Solution: Change PORT in backend/.env or kill process using port

**Session Not Persisting:**
- Check SESSION_SECRET is set in .env
- Ensure MongoDB connection is stable
- Clear browser cookies and retry

**CORS Errors:**
- Verify FRONTEND_URL in backend/.env matches frontend URL
- Check withCredentials: true in frontend API client

---

## License

MIT License - Free to use and modify

---

## Support

For questions or issues, please create an issue in the repository or contact the development team.

---

**Built with ❤️ using Node.js, React, MongoDB, and TypeScript**
