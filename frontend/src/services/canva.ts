import api, { API_URL } from './api';

/** Edit in Canva: open a picture in the user's Canva, then bring the result back as a new version. */
export const canvaAPI = {
  state: () => api.get<{ available: boolean; connected: boolean }>('/integrations/canva/state').then((r) => r.data),
  /** Returns the Canva editor link, or null after sending the user to connect Canva first. */
  startEdit: async (body: { target: 'library'; assetId: string } | { target: 'task'; taskId: string }): Promise<string | null> => {
    try {
      const r = await api.post<{ editUrl: string }>('/integrations/canva/edits', body);
      return r.data.editUrl;
    } catch (e: any) {
      if (e?.response?.data?.code === 'CANVA_NOT_CONNECTED') {
        window.location.href = `${API_URL.replace(/\/$/, '')}${e.response.data.connectPath}`;
        return null;
      }
      throw e;
    }
  },
  edits: (params: { assetId?: string; taskId?: string }) =>
    api.get<{ edits: { id: string; status: string; error: string | null; createdAt: string; editUrl: string }[] }>('/integrations/canva/edits', { params }).then((r) => r.data.edits),
  importEdit: (id: string) => api.post<{ message: string; unchanged?: boolean }>(`/integrations/canva/edits/${id}/import`, {}, { timeout: 180_000 }).then((r) => r.data),
  settings: () => api.get('/integrations/canva/settings').then((r) => r.data.settings),
  saveSettings: (body: Record<string, unknown>) => api.patch('/integrations/canva/settings', body).then((r) => r.data.settings)
};
