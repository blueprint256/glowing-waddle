# Campaign Management Platform

A full-stack collaborative campaign management and content production platform with role-based access control, hierarchical project organization, and comprehensive approval workflows.

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
- Hierarchical structure: Campaigns → Projects → Events
- 5 user roles with granular permissions (System Admin, Hybrid, Client, Marketer, Designer)
- RBAC enforcement at API and UI levels
- Team-based organization
- Project assignment with Assignment Authority Matrix
- Approval workflows
- Comments and collaboration
- Asset management with file uploads
- Audit logging for all critical actions
- Rate limiting and security headers

---

## Hierarchy & Data Model

```
Team
 └─ Campaign
     └─ Project
         └─ Event
             ├─ Comments
             ├─ Approvals
             └─ Assets
```

**Key Relationships:**
- Users belong to Teams
- Campaigns are owned by Teams
- Projects belong to Campaigns (inherit teamId)
- Events belong to Projects (inherit campaignId and teamId)
- Project Assignments link Users to Projects with roles

---

## User Roles & Permissions

### 1. System Administrator
- Full platform access
- Create/manage users and teams
- Override all restrictions
- Access audit logs

### 2. Hybrid User
- Manage campaigns, projects, and events
- Assign users to projects (from existing team members)
- **Cannot** create users or add users to teams
- Approve and publish content

### 3. Client
- View assigned campaigns/projects/events
- Comment and provide feedback
- Approve/reject content (where enabled)
- **Cannot** edit or create content

### 4. Marketer
- Create and manage campaigns/projects
- Create and edit events
- Assign Designers to projects (optional configuration)
- Request approvals
- **Cannot** create users

### 5. Designer
- Edit events assigned to them
- Upload assets
- Update event status
- **Cannot** publish or approve (by default)

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
- Marketer: `marketer@example.com / password123`
- Designer: `designer@example.com / password123`
- Client: `client@example.com / password123`
- One team, campaign, project, and sample events

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
- Admin: `admin@example.com / password123`
- Hybrid: `hybrid@example.com / password123`
- Marketer: `marketer@example.com / password123`

---

## Demo Workflow

### Scenario: Creating a Campaign End-to-End

1. **Login as System Admin**
   - Navigate to Users → Create users (Marketer, Designer, Client)
   - Navigate to Teams → Create team "Acme Marketing"
   - Assign all users to the team

2. **Switch to Hybrid User**
   - Navigate to Campaigns → Create New Campaign
   - Enter: Name, Description, Budget, select Team
   - Campaign created (status: Draft)

3. **Create Project**
   - Open campaign → New Project
   - Enter: Name, Description, Dates
   - Assign Marketer and Designer from team members

4. **Create Events (as Marketer)**
   - Open project → New Event
   - Enter: Name, Type (Post/Launch), Description, Schedule
   - Assign to Designer

5. **Designer works on Event**
   - Login as Designer
   - Open assigned event → Edit content
   - Upload assets (images, videos)
   - Mark as "Pending Approval"

6. **Approval Workflow**
   - Create approval request (assign to Client or Hybrid)
   - Reviewer receives notification
   - Approve/Reject with feedback

7. **Publish Event**
   - Once approved, Marketer publishes event
   - Status: Published

8. **Collaboration**
   - Team members add comments
   - @mention others for notifications
   - Track changes via audit log (Admin only)

---

## Assignment Authority Matrix

The system enforces strict rules for who can assign whom to projects:

| Assigning Role | Can Assign Marketer | Can Assign Designer |
|----------------|---------------------|---------------------|
| System Admin   | ✅ Yes              | ✅ Yes              |
| Hybrid         | ✅ Yes              | ✅ Yes              |
| Marketer       | ❌ No               | ✅ Yes (optional)   |
| Designer       | ❌ No               | ❌ No               |

**Key Rules:**
- Users can only be assigned to projects if they're already team members
- Only System Admin can add users to teams
- Hybrid and Marketer assign from existing team pool

---

## API Documentation

### Authentication Endpoints

- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Logout current session
- `GET /api/auth/me` - Get current user

### Resource Endpoints

- `/api/users` - User CRUD (System Admin only)
- `/api/teams` - Team CRUD (System Admin only)
- `/api/campaigns` - Campaign management
- `/api/projects` - Project management
  - `POST /api/projects/:id/assignments` - Assign user to project
- `/api/events` - Event management
  - `POST /api/events/:id/publish` - Publish event
- `/api/comments` - Comments on events/projects/campaigns
- `/api/approvals` - Approval requests and responses
- `/api/assets` - File uploads and downloads

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
- Create users, assign to teams
- Override permissions
- View audit logs

**Hybrid:**
- Create campaigns and projects
- Assign users to projects
- Approve and publish

**Marketer:**
- Create campaigns
- Manage events
- Request approvals

**Designer:**
- Edit assigned events
- Upload assets

**Client:**
- View content
- Provide feedback
- Approve/reject

### Automated Testing (Future)

Add unit tests for:
- RBAC middleware functions
- Assignment authority validation
- Approval workflow state transitions

Integration tests for:
- Complete campaign creation workflow
- Project assignment flow
- Event approval and publish flow

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

1. **File Storage**: Assets stored locally; use AWS S3/Cloud Storage for production
2. **No Email Notifications**: Mentions and approvals don't send emails
3. **Basic Analytics**: Limited to simple counts; add charts and metrics
4. **No Real-time Updates**: Refresh required; add WebSocket support
5. **Limited Validation**: Basic validation; enhance with comprehensive rules
6. **No Undo/Versioning**: Content changes are not versioned

### Future Enhancements

- [ ] Calendar view for scheduled events
- [ ] Drag-and-drop Kanban boards
- [ ] Advanced search and filtering
- [ ] Export reports (PDF/CSV)
- [ ] Mobile app (React Native)
- [ ] Integration with social media platforms
- [ ] Automated workflows and triggers
- [ ] Multi-language support
- [ ] Dark mode theme

---

## Assumptions & Design Decisions

1. **Session-based Auth**: Chose sessions over JWT for simplicity and server-side control
2. **MongoDB**: Selected for flexible schema and hierarchical data modeling
3. **Team Membership Required**: Users must belong to a team before project assignment
4. **Soft Deletes**: Users and teams marked inactive rather than hard deleted
5. **Single Team per User**: Users belong to one team at a time (can be extended)
6. **Local File Storage**: Simplified for prototype; production should use cloud storage
7. **No Email Verification**: Demo purposes only; add in production
8. **Password Requirements**: Minimum 6 characters (increase in production)

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
