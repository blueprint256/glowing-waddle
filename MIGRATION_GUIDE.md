# Migration Guide - Feature Updates Dec 2025

This document outlines the changes made in the `feature-updates-dec2025` branch and provides instructions for completing the remaining tasks.

## ✅ Completed Changes

### 1. Core Model Refactoring

#### User Model (`backend/src/models/User.ts`)
- ✅ **Removed roles**: Client, Marketer, Designer
- ✅ **Kept only**: System Admin and Hybrid
- ✅ **Updated default role**: Changed from DESIGNER to HYBRID

#### Campaign Model (`backend/src/models/Campaign.ts`)
- ✅ **Removed field**: `budget` (number)
- ✅ **Added field**: `archived` (boolean, default: false)
- ✅ **Note**: Campaigns no longer have team associations

#### Task Model (`backend/src/models/Task.ts`) - NEW FILE
- ✅ **Created** new Task model (replaces Event)
- ✅ **Removed field**: `assignedTo` (no longer assigns tasks to specific users)
- ✅ **Added fields**:
  - `designedImage` (string): S3 URL for product marketing image
  - `publishDate` (Date): When task should be published
  - `status` (enum): Updated to 'Pending', 'In Progress', 'Completed'
- ✅ **Renamed**: EventStatus → TaskStatus, EventType → TaskType

#### Asset Model (`backend/src/models/Asset.ts`)
- ✅ **Added field**: `location` (string) for S3 URLs
- ✅ **Renamed**: `eventId` → `taskId`
- ✅ **Updated indexes**: Changed from eventId to taskId

### 2. AWS S3 Integration

#### S3 Service Utility (`backend/src/utils/s3Service.ts`) - NEW FILE
- ✅ **Created** S3 service with functions:
  - `uploadToS3()`: Upload files to S3
  - `getSignedDownloadUrl()`: Generate signed URLs for private files
  - `deleteFromS3()`: Delete files from S3
  - `uploadTaskImage()`: Specific function for task images

#### Configuration
- ✅ **Added AWS SDK packages**: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- ✅ **Added environment variables** to `.env.example`:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_REGION`
  - `AWS_S3_BUCKET`

### 3. RBAC Middleware Updates

#### Partial Updates (`backend/src/middleware/rbac.ts`)
- ✅ **Updated imports**: Changed Event → Task
- ✅ **Updated canCreateCampaign**: Removed MARKETER from allowed roles (now only SYSTEM_ADMIN and HYBRID)

---

## 🔄 Remaining Tasks

### HIGH PRIORITY - Backend

#### 1. Complete RBAC Middleware Refactoring
**File**: `backend/src/middleware/rbac.ts`

**Tasks**:
- Remove or simplify `canAssignToProject` (since we only have 2 roles now)
- Remove `canEditContent` middleware (all authenticated users except Client could edit, but Client role is gone)
- Remove `canPublishEvent` middleware or rename to `canPublishTask`
- Update all Event references to Task throughout the file

**Example**:
```typescript
// Remove this entire function (references MARKETER, DESIGNER)
export const canAssignToProject = async (...) => {
  // DELETE THIS ENTIRE FUNCTION
};

// Simplify to:
export const canManageTasks = hasRole(UserRole.SYSTEM_ADMIN, UserRole.HYBRID);
```

#### 2. Create Task Routes
**File**: `backend/src/routes/task.routes.ts` (NEW FILE)

**Tasks**:
- Copy `backend/src/routes/event.routes.ts`
- Rename all `Event` → `Task`, `event` → `task`
- Remove `assignedTo` logic from create/update endpoints
- Add endpoint for uploading `designedImage`:
  ```typescript
  router.post('/:id/upload-image', upload.single('image'), async (req, res) => {
    const { location } = await uploadTaskImage(req.file);
    task.designedImage = location;
    await task.save();
  });
  ```
- Update validation to use new TaskStatus enum values

#### 3. Update Campaign Routes
**File**: `backend/src/routes/campaign.routes.ts`

**Tasks**:
- Remove `budget` field from create/update validation
- Remove `teamId` from create/update endpoints (teams feature deprecated)
- Add archive endpoint:
  ```typescript
  router.put('/:id/archive', isAuthenticated, canCreateCampaign, async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    campaign.archived = true;
    await campaign.save();
    res.json({ success: true, campaign });
  });
  ```
- Add query filter for archived campaigns:
  ```typescript
  // GET /api/campaigns?includeArchived=true
  if (req.query.includeArchived !== 'true') {
    query.archived = false;
  }
  ```

#### 4. Update Asset Routes
**File**: `backend/src/routes/asset.routes.ts`

**Tasks**:
- Update upload endpoint to use S3:
  ```typescript
  const { location, key } = await uploadToS3(req.file, 'assets');
  const asset = await Asset.create({
    ...
    path: key,  // Store S3 key
    location,   // Store S3 URL
    taskId: taskId ? new mongoose.Types.ObjectId(taskId) : undefined,
  });
  ```
- Update download endpoint to redirect to S3 URL or use signed URL
- Update delete endpoint to call `deleteFromS3(asset.path)` before deleting DB record
- Change `eventId` to `taskId` in all request body references

#### 5. Update Server Routes Registration
**File**: `backend/src/server.ts`

**Tasks**:
- Import task routes: `import taskRoutes from './routes/task.routes';`
- Register task routes: `app.use('/api/tasks', taskRoutes);`
- Remove event routes: `app.use('/api/events', eventRoutes);` ← DELETE THIS LINE

#### 6. Update Validation Middleware
**File**: `backend/src/middleware/validation.ts`

**Tasks**:
- Update `validateUserCreation`: Remove client, marketer, designer from role validation
  ```typescript
  body('role').isIn(['system_admin', 'hybrid']).withMessage('Invalid role'),
  ```
- Rename `validateEventCreation` → `validateTaskCreation`
- Update task validation to match new Task model fields
- Remove budget validation from campaign creation

#### 7. Update Seed Script
**File**: `backend/src/scripts/seed.ts`

**Tasks**:
- Remove creation of Client, Marketer, Designer users
- Keep only admin and hybrid user creation
- Update Event imports to Task
- Update Event.create() to Task.create()
- Remove `assignedTo` field from task creation
- Remove `budget` from campaign creation

---

### HIGH PRIORITY - Frontend

#### 1. Update Type Definitions
**File**: `frontend/src/types/index.ts`

**Tasks**:
- Update `UserRole` enum: Remove CLIENT, MARKETER, DESIGNER
- Rename `Event` interface to `Task`
- Rename `EventStatus` to `TaskStatus`, update values
- Remove `assignedTo` field from Task interface
- Add to Task interface:
  ```typescript
  designedImage?: string;
  publishDate?: string;
  status: TaskStatus; // 'Pending' | 'In Progress' | 'Completed'
  ```
- Remove `budget` from Campaign interface
- Add `archived: boolean` to Campaign interface
- Update Asset interface: `eventId` → `taskId`, add `location: string`

#### 2. Update API Service
**File**: `frontend/src/services/api.ts`

**Tasks**:
- Rename `eventAPI` → `taskAPI`
- Update all `/api/events` → `/api/tasks`
- Add campaign archive endpoint:
  ```typescript
  archiveCampaign: (id: string) => api.put(`/campaigns/${id}/archive`)
  ```
- Add task image upload:
  ```typescript
  uploadTaskImage: (id: string, formData: FormData) =>
    api.post(`/tasks/${id}/upload-image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  ```
- Update asset API to use `taskId` instead of `eventId`

#### 3. Update UserManagement Page
**File**: `frontend/src/pages/Admin/UserManagement.tsx`

**Tasks**:
- Update role dropdown to only show System Admin and Hybrid:
  ```typescript
  {Object.values(UserRole).map((role) => (
    <MenuItem key={role} value={role}>
      {role}
    </MenuItem>
  ))}
  ```
- Remove team selection dropdown (teams feature has been deprecated)
- This fixes the "blank page" issue (if any)

#### 4. Update CampaignsList Page
**File**: `frontend/src/pages/Campaigns/CampaignsList.tsx`

**Tasks**:
- Remove `budget` field from create dialog
- Remove `teamId` field from create dialog (teams feature deprecated)
- Add filter toggle for archived campaigns:
  ```typescript
  const [showArchived, setShowArchived] = useState(false);
  // In loadCampaigns():
  const res = await campaignAPI.getAll({ includeArchived: showArchived });
  ```

#### 5. Update CampaignDetail Page
**File**: `frontend/src/pages/Campaigns/CampaignDetail.tsx`

**Tasks**:
- Remove budget display
- Add "Archive Campaign" button (visible to Hybrid users):
  ```typescript
  <Button
    variant="outlined"
    color="warning"
    onClick={handleArchive}
  >
    Archive Campaign
  </Button>
  ```
- Show archived badge if campaign is archived

#### 6. Rename Event Pages to Task Pages
**Files to Rename**:
- `frontend/src/pages/Events/` → `frontend/src/pages/Tasks/`
- `EventDetail.tsx` → `TaskDetail.tsx`

**Tasks**:
- Update all Event imports to Task
- Update API calls from eventAPI to taskAPI
- Remove "Assigned To" display
- Add upload button for designed image
- Add publish date picker
- Add status dropdown (Pending, In Progress, Completed)

#### 7. Update App Routing
**File**: `frontend/src/App.tsx`

**Tasks**:
- Update imports: `EventDetail` → `TaskDetail`
- Update routes:
  ```typescript
  <Route path="events/:id" element={<EventDetail />} />
  // CHANGE TO:
  <Route path="tasks/:id" element={<TaskDetail />} />
  ```

#### 8. Update Navigation (DashboardLayout)
**File**: `frontend/src/components/Layout/DashboardLayout.tsx`

**Tasks**:
- Remove "Teams" menu item (teams feature deprecated)
- Add "Details Sheet" menu item:
  ```typescript
  { text: 'Details Sheet', icon: <ListIcon />, path: '/details-sheet', roles: ['all'] }
  ```
- Update role filtering (only check for SYSTEM_ADMIN and HYBRID)

#### 9. Create Details Sheet Component
**File**: `frontend/src/pages/DetailsSheet.tsx` (NEW FILE)

**Tasks**:
- Create hierarchical UI as specified (Campaign → Project → Task)
- Use MUI Accordion for collapse functionality
- Use MUI Table for task table
- Columns: Date, Task Name, Status, Photos, Notes, Last Updated
- Fetch campaigns, lazy-load projects/tasks on expand
- Use MUI Chip for status badges
- Use MUI LinearProgress for campaign progress
- Implement progressive disclosure (only load data when expanded)

**Example structure**:
```typescript
<Box>
  {campaigns.map(campaign => (
    <Accordion key={campaign._id}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography>{campaign.name}</Typography>
        <LinearProgress value={progressPercent} />
      </AccordionSummary>
      <AccordionDetails>
        {projects.map(project => (
          <Accordion>
            <AccordionSummary>
              {project.name} - {completedTasks}/{totalTasks} tasks
            </AccordionSummary>
            <AccordionDetails>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Task Name</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Photos</TableCell>
                    <TableCell>Notes</TableCell>
                    <TableCell>Last Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tasks.map(task => (
                    <TableRow key={task._id}>
                      <TableCell>{task.publishDate}</TableCell>
                      <TableCell>{task.name}</TableCell>
                      <TableCell>
                        <Chip label={task.status} color={statusColor} />
                      </TableCell>
                      <TableCell>
                        {task.designedImage && <PhotoIcon />}
                      </TableCell>
                      <TableCell>{task.description}</TableCell>
                      <TableCell>{task.updatedAt}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        ))}
      </AccordionDetails>
    </Accordion>
  ))}
</Box>
```

---

## 📋 Step-by-Step Completion Guide

### Phase 1: Complete Backend (2-3 hours)
1. Finish RBAC middleware updates
2. Create task.routes.ts (copy from event.routes.ts and modify)
3. Update campaign.routes.ts (add archive endpoint)
4. Update asset.routes.ts (integrate S3)
5. Update validation.ts
6. Update server.ts (register task routes, remove event routes)
7. Update seed.ts
8. Run `npm install` in backend to install AWS SDK
9. Test backend with Postman/Thunder Client

### Phase 2: Update Frontend Types & Services (1 hour)
1. Update types/index.ts
2. Update services/api.ts
3. Run `npm install` in frontend if needed

### Phase 3: Update Existing Pages (2 hours)
1. Update UserManagement.tsx
2. Update CampaignsList.tsx and CampaignDetail.tsx
3. Rename Events folder to Tasks, update TaskDetail.tsx
4. Update App.tsx routing
5. Update DashboardLayout.tsx navigation

### Phase 4: Create Details Sheet (2-3 hours)
1. Create DetailsSheet.tsx component
2. Implement hierarchical accordion structure
3. Add data fetching with progressive disclosure
4. Style with MUI components
5. Test all expand/collapse functionality

### Phase 5: Testing & Documentation (1 hour)
1. Test all CRUD operations
2. Test role permissions
3. Test S3 uploads (or mock with local storage if no AWS account)
4. Update README.md with new features
5. Test entire workflow end-to-end

---

## 🔧 Quick Reference: Files Modified vs. Files Created

### Modified Files
- `backend/src/models/User.ts`
- `backend/src/models/Campaign.ts`
- `backend/src/models/Asset.ts`
- `backend/src/middleware/rbac.ts` (partial)
- `backend/package.json`
- `backend/.env.example`

### New Files Created
- `backend/src/models/Task.ts`
- `backend/src/utils/s3Service.ts`

### Files That Still Need Updates
- `backend/src/middleware/rbac.ts` (complete the refactoring)
- `backend/src/middleware/validation.ts`
- `backend/src/routes/campaign.routes.ts`
- `backend/src/routes/asset.routes.ts`
- `backend/src/scripts/seed.ts`
- `backend/src/server.ts`
- All frontend files listed above

### Files to Create
- `backend/src/routes/task.routes.ts`
- `frontend/src/pages/DetailsSheet.tsx`
- `frontend/src/pages/Tasks/TaskDetail.tsx` (rename from EventDetail)

### Files to Delete (after refactoring)
- `backend/src/routes/event.routes.ts` (replaced by task.routes.ts)
- `backend/src/models/Event.ts` (replaced by Task.ts)
- `frontend/src/pages/Events/` (renamed to Tasks/)
- `frontend/src/pages/Admin/TeamManagement.tsx` (teams feature deprecated)

---

## 🎯 Testing Checklist

After completing all changes:

**Backend**:
- [ ] Server starts without errors
- [ ] Seed script creates only admin and hybrid users
- [ ] Can create tasks with new fields (designedImage, publishDate, status)
- [ ] Can upload files to S3 (or local storage as fallback)
- [ ] Can archive campaigns
- [ ] RBAC enforces System Admin and Hybrid permissions correctly

**Frontend**:
- [ ] User creation shows only System Admin and Hybrid roles
- [ ] Campaign creation doesn't show budget or team fields
- [ ] Can archive campaigns from campaign detail page
- [ ] Task detail page shows new fields
- [ ] Details Sheet displays hierarchical data correctly
- [ ] Navigation doesn't show Teams link
- [ ] Navigation shows Details Sheet link

**Integration**:
- [ ] Full workflow: Create campaign → create project → create task → upload image → set status → archive campaign
- [ ] Details Sheet lazy-loads data on expand
- [ ] S3 uploads work (or gracefully fall back to local storage)

---

## ⚠️ Important Notes

1. **AWS S3 Setup**: If you don't have AWS credentials, you can:
   - Use a free tier AWS account
   - Modify `s3Service.ts` to fall back to local storage
   - Use MinIO (S3-compatible local server) for development

2. **Database Migration**: The model changes are backward-incompatible. You may need to:
   - Drop the database and reseed: `mongo campaign_management --eval "db.dropDatabase()"`
   - Or write a migration script to update existing data

3. **Testing**: Test thoroughly with both System Admin and Hybrid users to ensure RBAC works correctly

4. **Git Workflow**: All changes are in the `feature-updates-dec2025` branch. Do NOT merge to main until fully tested.

---

## 📞 Support

If you encounter issues:
1. Check console for TypeScript errors
2. Verify all imports are updated (Event → Task)
3. Ensure MongoDB is running
4. Check that .env variables are set correctly
5. Run `npm install` in both backend and frontend after pulling changes

---

**Branch**: `feature-updates-dec2025`
**Status**: Core models updated, remaining implementation needed
**Estimated Time to Complete**: 8-10 hours
