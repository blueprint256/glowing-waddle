import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

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
    // Handle errors gracefully
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
export const userAPI = {
  getAll: (params?: any) => api.get('/users', { params }),
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
  delete: (id: string) => api.delete(`/campaigns/${id}`),
  generate: (id: string, data: { command: string }) => api.post(`/campaigns/${id}/generate`, data)
};

// Project API
export const projectAPI = {
  getAll: (params?: any) => api.get('/projects', { params }),
  getById: (id: string) => api.get(`/projects/${id}`),
  create: (data: any) => api.post('/projects', data),
  update: (id: string, data: any) => api.put(`/projects/${id}`, data),
  assignUser: (id: string, data: any) => api.post(`/projects/${id}/assignments`, data),
  removeUser: (id: string, userId: string) => api.delete(`/projects/${id}/assignments/${userId}`)
};

// Task API
export const taskAPI = {
  getAll: (params?: any) => api.get('/tasks', { params }),
  getById: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  uploadImage: (id: string, formData: FormData) => api.post(`/tasks/${id}/upload-image`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  refineDescription: (id: string) => api.post(`/tasks/${id}/refine-description`),
  generatePoster: (id: string) => api.post(`/tasks/${id}/generate-poster`),
  adoptPoster: (id: string, data: { generatedImageUrl: string }) => api.patch(`/tasks/${id}/adopt-poster`, data),
  delete: (id: string) => api.delete(`/tasks/${id}`)
};

// Comment API
export const commentAPI = {
  getAll: (params?: any) => api.get('/comments', { params }),
  create: (data: any) => api.post('/comments', data),
  update: (id: string, data: any) => api.put(`/comments/${id}`, data),
  delete: (id: string) => api.delete(`/comments/${id}`)
};

// Asset API
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
  create: (data: { command: string; promptId: string }) => api.post('/command-mappings', data),
  update: (id: string, data: { command?: string; promptId?: string }) => api.patch(`/command-mappings/${id}`, data),
  delete: (id: string) => api.delete(`/command-mappings/${id}`)
};

export default api;
