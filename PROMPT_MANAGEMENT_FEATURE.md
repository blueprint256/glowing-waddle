# Prompt Management Feature

## Overview
This feature enables System Admins to manage LLM prompts dynamically through a user-friendly interface, allowing for customizable AI-driven content generation without code changes.

## Key Components

### Backend

#### 1. Prompt Model (`backend/src/models/Prompt.ts`)
- **Schema Fields:**
  - `name`: Unique identifier for the prompt (String, required, unique)
  - `details`: The prompt template text with placeholders (String, required)
  - `createdAt`, `updatedAt`: Timestamps (auto-generated)

#### 2. Prompt Routes (`backend/src/routes/prompt.routes.ts`)
Admin-only API endpoints:
- `GET /api/prompts` - List all prompts (paginated)
- `GET /api/prompts/:id` - Get prompt by ID
- `GET /api/prompts/name/:name` - Get prompt by name (authenticated users)
- `POST /api/prompts` - Create new prompt
- `PATCH /api/prompts/:id` - Update existing prompt
- `DELETE /api/prompts/:id` - Delete prompt

**Security:** All endpoints require authentication. CRUD operations restricted to System Admins using `isSystemAdmin` middleware.

#### 3. LLM Service (`backend/src/services/llmService.ts`)
Core functionality for super prompt compilation:

**Functions:**
- `getPromptByName(name)` - Fetch prompt template from database
- `compileSuperPrompt(template, params)` - Replace placeholders with actual data
- `fetchAndCompilePrompt(name, params)` - Combined fetch + compile
- `sendToLLM(prompt, options)` - Send compiled prompt to LLM API (placeholder)
- `generateWithPrompt(name, params, options)` - Complete workflow

**Supported Placeholders:**
- `{companyInfo}` - Full company information
- `{companyName}`, `{sector}`, `{brandTone}` - Individual company fields
- `{campaignDetails}` - Full campaign information
- `{campaignName}`, `{coreMessages}`, `{hashtags}` - Individual campaign fields
- Custom placeholders via params object

#### 4. Integration Example (`backend/src/routes/campaign.routes.ts`)
New endpoint: `POST /api/campaigns/:id/generate-tasks`
- Demonstrates LLM integration with prompt system
- Fetches user company info and campaign details
- Compiles prompt with dynamic data
- Returns compiled prompt (ready for LLM API integration)

### Frontend

#### 1. Updated API Service (`frontend/src/services/api.ts`)
Added `promptAPI` object with methods:
- `getAll(params)` - Fetch all prompts
- `getById(id)` - Fetch single prompt
- `getByName(name)` - Fetch by name
- `create(data)` - Create prompt
- `update(id, data)` - Update prompt
- `delete(id)` - Delete prompt

#### 2. Settings Page Enhancement (`frontend/src/pages/Settings.tsx`)
**New "Prompts" Tab (System Admin only):**
- Lists all prompts in a table
- Shows prompt name and details preview
- Actions: Edit, Delete
- "Create Prompt" button opens modal

**Create/Edit Modal:**
- Name field (unique identifier)
- Details textarea (supports placeholders)
- Validation (required fields, unique name)
- Info alert showing available placeholders

**Features:**
- Loading states during fetch/save operations
- Success/error toast notifications
- Confirmation dialog for deletion
- Responsive table layout
- Tooltip hints for better UX

## Usage Guide

### For System Admins

#### Creating a Prompt
1. Navigate to **Settings > Prompts** tab
2. Click **"Create Prompt"** button
3. Enter unique **Name** (e.g., "Generate Campaign Tasks")
4. Enter **Details** with placeholders:
   ```
   Generate a list of 5 social media tasks for the following campaign:

   Company: {companyName}
   Brand Tone: {brandTone}

   Campaign Name: {campaignName}
   Core Messages: {coreMessages}
   Hashtags: {hashtags}

   Consider the company's unique selling position: {companyInfo}
   ```
5. Click **"Create"**

#### Editing a Prompt
1. Click the **Edit** icon next to any prompt
2. Modify name or details
3. Click **"Update"**

#### Deleting a Prompt
1. Click the **Delete** icon
2. Confirm deletion

### For Developers

#### Using Prompts in Backend Code
```typescript
import { fetchAndCompilePrompt, generateWithPrompt } from '../services/llmService';

// Example: Generate campaign tasks
const promptParams = {
  companyInfo: user.companyInfo,
  campaignDetails: {
    name: campaign.name,
    description: campaign.description,
    coreMessages: campaign.coreMessages,
    hashtags: campaign.hashtags
  }
};

// Compile prompt only
const compiledPrompt = await fetchAndCompilePrompt('Generate Campaign Tasks', promptParams);

// Or use with LLM API (requires integration)
const result = await generateWithPrompt('Generate Campaign Tasks', promptParams, {
  model: 'gpt-4',
  temperature: 0.7
});
```

#### Integrating LLM API
The `sendToLLM` function in `llmService.ts` is a placeholder. To integrate with OpenAI:

1. Install OpenAI SDK: `npm install openai`
2. Add API key to `.env`: `OPENAI_API_KEY=your_key_here`
3. Update `sendToLLM` function:
   ```typescript
   import OpenAI from 'openai';

   export async function sendToLLM(prompt: string, options?: {...}): Promise<string> {
     const openai = new OpenAI({
       apiKey: process.env.OPENAI_API_KEY
     });

     const response = await openai.chat.completions.create({
       model: options?.model || 'gpt-4',
       messages: [{ role: 'user', content: prompt }],
       temperature: options?.temperature || 0.7,
       max_tokens: options?.maxTokens || 2000
     });

     return response.choices[0].message.content || '';
   }
   ```

## Security Considerations

1. **Role-Based Access:**
   - Prompts tab only visible to System Admins
   - Hybrid Users get 403 if they try to access CRUD endpoints
   - All routes protected with `isAuthenticated` + `isSystemAdmin` middleware

2. **Validation:**
   - Unique prompt names enforced at database level
   - Required fields validated on both frontend and backend
   - MongoDB ID validation on update/delete operations

3. **Audit Logging:**
   - Campaign task generation logged with prompt name
   - Can extend to log prompt CRUD operations if needed

## Example Prompts

### Generate Campaign Tasks
```
You are a social media marketing expert. Generate 5 creative tasks for the following campaign:

Company Information:
{companyInfo}

Campaign Details:
{campaignDetails}

Tasks should align with the brand tone and incorporate the core messages and hashtags.
```

### Generate Social Media Post
```
Create a social media post for {companyName} with the following details:

Brand Tone: {brandTone}
Core Message: {coreMessages}
Hashtags: {hashtags}

The post should be engaging and align with our target audience: {audienceProfile}
```

### Content Guidelines Check
```
Review the following content against our brand guidelines:

Content: {content}

Guidelines:
{globalRules}

Brand Tone: {brandTone}

Provide feedback on alignment and suggestions for improvement.
```

## Future Enhancements

1. **Prompt Versioning:** Track changes to prompts over time
2. **Prompt Templates:** Pre-built templates for common use cases
3. **Usage Analytics:** Track which prompts are used most frequently
4. **A/B Testing:** Compare different prompt variations
5. **Prompt Sharing:** Export/import prompts between environments
6. **Multi-LLM Support:** Switch between OpenAI, Anthropic, etc.
7. **Token Cost Tracking:** Monitor API usage and costs

## Files Modified/Created

### Backend
- ✅ **Created:** `backend/src/models/Prompt.ts` - Mongoose schema
- ✅ **Created:** `backend/src/routes/prompt.routes.ts` - CRUD API endpoints
- ✅ **Created:** `backend/src/services/llmService.ts` - Prompt compilation logic
- ✅ **Modified:** `backend/src/server.ts` - Registered prompt routes
- ✅ **Modified:** `backend/src/routes/campaign.routes.ts` - Added generate-tasks endpoint

### Frontend
- ✅ **Modified:** `frontend/src/services/api.ts` - Added promptAPI methods
- ✅ **Modified:** `frontend/src/pages/Settings.tsx` - Added Prompts tab with full CRUD UI

## Testing Checklist

- [x] System Admin can view Prompts tab in Settings
- [x] Hybrid User cannot access Prompts tab
- [x] Create prompt with unique name works
- [x] Create prompt with duplicate name shows error
- [x] Edit prompt updates correctly
- [x] Delete prompt removes from database
- [x] Prompt compilation replaces placeholders correctly
- [x] Generate tasks endpoint compiles prompt with campaign data
- [ ] Integration with actual LLM API (OpenAI/Anthropic) works
- [x] All endpoints respect RBAC permissions

## Conclusion

This feature provides a flexible, secure, and user-friendly way for System Admins to manage LLM prompts dynamically. It's designed to integrate seamlessly with existing workflows and can be extended to support various LLM providers and use cases.
