import axios from 'axios';
import type { LogoCorner, PictureFormat, ReferenceRole } from '../types';

export const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    // Prevent browser caching by requesting fresh data
    'Cache-Control': 'no-cache'
  }
});

// Response interceptor to handle edge cases with cached/empty responses
api.interceptors.response.use(
  (response) => {
    // Ensure response data exists for successful requests
    if (response.status === 200 && !response.data) {
      console.warn('Received empty response data for:', response.config.url);
      response.data = {};
    }
    return response;
  },
  (error) => {
    // Session expired or signed out elsewhere: tell the app once, so it can send the user to the login
    // page instead of every screen showing its own error. (Sign-in calls themselves are ignored.)
    const url: string = error?.config?.url || '';
    if (error?.response?.status === 401 && !url.includes('/auth/')) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  signup: (email: string, password: string, firstName: string, lastName: string) =>
    api.post('/auth/signup', { email, password, firstName, lastName }),
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  getCurrentUser: () => api.get('/auth/me'),
  checkAuth: () => api.get('/auth/check')
};

// User API
/** Monthly AI allowance (backend: services/aiAllowance.ts). limit 0 / remaining null = no limit. */
export interface AllowanceLine {
  used: number;
  limit: number;
  remaining: number | null;
}
export interface AIUsage {
  images: AllowanceLine;
  blueMessages: AllowanceLine;
  resetsAt: string;
  unlimited: boolean;
}

export const userAPI = {
  getAll: (params?: any) => api.get('/users', { params }),
  /** Change your own name. */
  updateMe: (data: { firstName?: string; lastName?: string }) => api.patch('/users/me', data),
  changePassword: (currentPassword: string, newPassword: string) => api.post('/users/me/password', { currentPassword, newPassword }),
  myAIUsage: () => api.get<{ usage: AIUsage }>('/users/me/ai-usage').then((r) => r.data.usage),
  aiUsage: (id: string) =>
    api.get<{ usage: AIUsage; aiAllowance: { images: number | null; blueMessages: number | null } }>(`/users/${id}/ai-usage`).then((r) => r.data),
  allowanceDefaults: () => api.get<{ aiImagesPerMonth: number; blueMessagesPerMonth: number }>('/users/settings/ai-allowance').then((r) => r.data),
  saveAllowanceDefaults: (data: { aiImagesPerMonth?: number; blueMessagesPerMonth?: number }) =>
    api.patch<{ aiImagesPerMonth: number; blueMessagesPerMonth: number }>('/users/settings/ai-allowance', data).then((r) => r.data),
  getById: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  getCompanyInfo: () => api.get('/users/me/company-info'),
  updateCompanyInfo: (data: any) => api.patch('/users/me/company-info', data),
  uploadLogo: (logoType: 'primary' | 'secondary' | 'tertiary', formData: FormData) =>
    api.post(`/users/me/upload-logo?type=${logoType}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
};

// Campaign API
export const campaignAPI = {
  getAll: (params?: any) => api.get('/campaigns', { params }),
  getById: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: any) => api.post('/campaigns', data),
  update: (id: string, data: any) => api.put(`/campaigns/${id}`, data),
  archive: (id: string) => api.put(`/campaigns/${id}/archive`),
  unarchive: (id: string) => api.put(`/campaigns/${id}/unarchive`),
  /** Archives the campaign (its unsent scheduled posts are cancelled). */
  delete: (id: string) => api.delete(`/campaigns/${id}`),
  /** Deletes the campaign itself; its posts stay, without a campaign. */
  deleteKeepingPosts: (id: string) => api.delete<{ message: string; keptPosts: number }>(`/campaigns/${id}`, { params: { keepPosts: 'true' } }),
  /** Plan with AI, step 1: a list of posts to review (nothing is saved). Can take a minute or two. */
  plan: (id: string, body: PlanRequest) => api.post<PlanDraft>(`/campaigns/${id}/plan`, body, { timeout: 240000 }).then((r) => r.data),
  /** Plan with AI, step 2: create the reviewed posts. */
  applyPlan: (id: string, posts: PlanPost[]) =>
    api.post<{ message: string; postIds: string[]; postCount: number }>(`/campaigns/${id}/plan/apply`, { posts }).then((r) => r.data)
};

/** Plan with AI (backend: lib/campaignPlan.ts). */
export interface PlanPost {
  name: string;
  brief: string;
  caption: string;
  day: string | null;
  status: 'Idea' | 'Draft' | 'Ready';
}
export interface PlanRequest {
  notes?: string;
  from?: string;
  to?: string;
  perWeek?: number;
}
export interface PlanDraft {
  posts: PlanPost[];
  from: string;
  to: string;
  source: 'command' | 'builtin';
}

// Themes (API: projects) were retired in Post v2; only old links read one (pages/Redirects.tsx).
export const projectAPI = {
  getById: (id: string) => api.get(`/projects/${id}`)
};

// Task API
/** Ways to improve a caption (backend: services/postAI.ts CAPTION_STYLES). */
export type CaptionStyle = 'improve' | 'shorter' | 'playful' | 'professional' | 'fix' | 'cta' | 'hashtags' | 'x' | 'linkedin' | 'instagram' | 'write';

export interface CreateImageBody {
  /** Unsaved "What's this post about?" text. */
  description?: string;
  format?: PictureFormat;
  logo?: LogoCorner | null;
}
export interface ChangeImageBody {
  instruction: string;
  /** The picture to change (default: the current one). */
  from?: string;
  logo?: LogoCorner | null;
}

export const taskAPI = {
  getAll: (params?: any) => api.get('/tasks', { params }),
  getById: (id: string) => api.get(`/tasks/${id}`),
  /** { campaignId? (null = none), name? (empty = automatic), description?, content?, taskDate?, status? } */
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  uploadImage: (id: string, formData: FormData) => api.post(`/tasks/${id}/upload-image`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  /** Removes the picture (it stays among the earlier pictures). */
  removeImage: (id: string) => api.delete(`/tasks/${id}/image`),
  /** Create image with AI: adds an AI draft. Takes 15–60 seconds. */
  createImage: (id: string, body: CreateImageBody) => api.post(`/tasks/${id}/image/create`, body, { timeout: 240_000 }),
  /** Change image with AI: adds an AI draft with the change. */
  changeImage: (id: string, body: ChangeImageBody) => api.post(`/tasks/${id}/image/change`, body, { timeout: 240_000 }),
  /** Makes an AI draft or an earlier picture the post's picture. */
  useImage: (id: string, url: string) => api.post(`/tasks/${id}/image/use`, { url }),
  discardDraft: (id: string, draftId: string) => api.delete(`/tasks/${id}/image/drafts/${encodeURIComponent(draftId)}`),
  /** Reference picture from a file (form fields "image" and "role"). */
  addReferenceFile: (id: string, file: File, role: ReferenceRole) => {
    const form = new FormData();
    form.append('image', file);
    form.append('role', role);
    return api.post(`/tasks/${id}/references`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  /** Reference picture from the Library, or one of the post's own pictures (url). */
  addReference: (id: string, body: { libraryAssetId?: string; url?: string; role: ReferenceRole }) => api.post(`/tasks/${id}/references`, body),
  updateReference: (id: string, refId: string, body: { role?: ReferenceRole; name?: string }) => api.patch(`/tasks/${id}/references/${encodeURIComponent(refId)}`, body),
  removeReference: (id: string, refId: string) => api.delete(`/tasks/${id}/references/${encodeURIComponent(refId)}`),
  /** Write / improve a caption for a post not created yet (suggestion only). */
  suggestCaption: (body: { style?: CaptionStyle; caption?: string; brief?: string; campaignId?: string | null }) =>
    api.post<{ suggestion: string; style: CaptionStyle; label: string; original: string }>('/tasks/improve-caption', body),
  /** Write / improve caption (suggestion only). */
  improveCaption: (id: string, body: { style?: CaptionStyle; caption?: string; brief?: string } = {}) =>
    api.post<{ suggestion: string; style: CaptionStyle; label: string; original: string }>(`/tasks/${id}/improve-caption`, body)
};

// Comment API
export const commentAPI = {
  getAll: (params?: any) => api.get('/comments', { params }),
  create: (data: any) => api.post('/comments', data),
  update: (id: string, data: any) => api.put(`/comments/${id}`, data),
  delete: (id: string) => api.delete(`/comments/${id}`)
};

// Asset API
// Claude connector (MCP): OAuth consent + connected apps
export const oauthAPI = {
  getRequest: (requestId: string) => api.get(`/oauth/requests/${encodeURIComponent(requestId)}`),
  decide: (requestId: string, approve: boolean) =>
    api.post(`/oauth/requests/${encodeURIComponent(requestId)}/decision`, { approve })
};

export const connectedAppsAPI = {
  list: () => api.get('/connected-apps'),
  disconnect: (clientId: string) => api.delete(`/connected-apps/${encodeURIComponent(clientId)}`)
};

export const assetAPI = {
  getAll: (params?: any) => api.get('/assets', { params }),
  getById: (id: string) => api.get(`/assets/${id}`),
  upload: (formData: FormData) => api.post('/assets', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  download: (id: string) => api.get(`/assets/${id}/download`, { responseType: 'blob' }),
  delete: (id: string) => api.delete(`/assets/${id}`)
};

// Prompt API
export const promptAPI = {
  getAll: (params?: any) => api.get('/prompts', { params }),
  getById: (id: string) => api.get(`/prompts/${id}`),
  getByName: (name: string) => api.get(`/prompts/name/${name}`),
  create: (data: any) => api.post('/prompts', data),
  update: (id: string, data: any) => api.patch(`/prompts/${id}`, data),
  delete: (id: string) => api.delete(`/prompts/${id}`)
};

// LLM API (System Admin only)
export const llmAPI = {
  run: (data: { promptName: string; dynamicData: any }) => api.post('/llm/run', data),
  generateCampaignTasks: (data: { campaignId: string; promptName?: string }) =>
    api.post('/llm/generate-campaign-tasks', data),
  getUsage: (params?: any) => api.get('/llm/usage', { params })
};

// Integrations API
export const integrationsAPI = {
  getStatus: () => api.get('/integrations/status'),
  canva: {
    connect: () => window.location.href = `${API_URL}/integrations/canva`,
    disconnect: () => api.post('/integrations/canva/disconnect')
  },
  openai: {
    getStatus: () => api.get('/integrations/openai/status'),
    saveKey: (apiKey: string) => api.patch('/integrations/openai/key', { apiKey }),
    testConnection: () => api.post('/integrations/openai/test'),
    removeKey: () => api.delete('/integrations/openai/key')
  },
  anthropic: {
    getStatus: () => api.get('/integrations/anthropic/status'),
    saveKey: (apiKey: string) => api.patch('/integrations/anthropic/key', { apiKey }),
    testConnection: () => api.post('/integrations/anthropic/test'),
    removeKey: () => api.delete('/integrations/anthropic/key')
  },
  grok: {
    getStatus: () => api.get('/integrations/grok/status'),
    saveKey: (apiKey: string) => api.patch('/integrations/grok/key', { apiKey }),
    testConnection: () => api.post('/integrations/grok/test'),
    removeKey: () => api.delete('/integrations/grok/key')
  },
  gemini: {
    getStatus: () => api.get('/integrations/gemini/status'),
    saveKey: (apiKey: string) => api.patch('/integrations/gemini/key', { apiKey }),
    testConnection: () => api.post('/integrations/gemini/test'),
    removeKey: () => api.delete('/integrations/gemini/key')
  },
  llm: {
    getDefault: () => api.get('/integrations/llm/default'),
    saveDefault: (provider: string, model: string) => api.patch('/integrations/llm/default', { provider, model })
  },
  imageLlm: {
    getDefault: () => api.get('/integrations/image-llm/default'),
    saveDefault: (provider: string, model: string) => api.patch('/integrations/image-llm/default', { provider, model })
  }
};

// Command Mapping API (System Admin only)
export const commandMappingAPI = {
  getAll: () => api.get('/command-mappings'),
  getByCommand: (commandName: string) => api.get(`/command-mappings/command/${commandName}`),
  create: (data: {
    command: string;
    promptId?: string;
    chainId?: string;
    steps?: Array<{ promptId: string; provider?: string; model?: string }>
  }) => api.post('/command-mappings', data),
  update: (id: string, data: {
    command?: string;
    promptId?: string;
    chainId?: string;
    steps?: Array<{ promptId: string; provider?: string; model?: string }>
  }) => api.patch(`/command-mappings/${id}`, data),
  delete: (id: string) => api.delete(`/command-mappings/${id}`)
};

// Chain API (System Admin only)
export const chainAPI = {
  getAll: () => api.get('/chains'),
  getById: (id: string) => api.get(`/chains/${id}`),
  create: (data: {
    name: string;
    steps: Array<{
      description: string;
      prompt: string;
      provider: string;
      model: string;
      carryForwardImages?: boolean;
    }>
  }) => api.post('/chains', data),
  update: (id: string, data: {
    name?: string;
    steps?: Array<{
      description: string;
      prompt: string;
      provider: string;
      model: string;
      carryForwardImages?: boolean;
    }>
  }) => api.patch(`/chains/${id}`, data),
  delete: (id: string) => api.delete(`/chains/${id}`)
};

export default api;
