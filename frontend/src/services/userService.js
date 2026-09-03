import { api, getAuthToken } from './api';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const userService = {
  getAll: (filters = {}) => {
    const params = new URLSearchParams(filters).toString();
    return api.get(`/users${params ? `?${params}` : ''}`);
  },
  /** Name-only approver list — usable by Generator/Approver, not just Super Admin. */
  listApprovers: () => api.get('/users/approvers'),
  /** Registered recipient accounts (role='recipient') — Secure Document Delivery module's picker. */
  listRecipients: () => api.get('/users/recipients'),
  create: (payload) => api.post('/users', payload),
  update: (id, payload) => api.put(`/users/${id}`, payload),
  updateStatus: (id, isActive) => api.patch(`/users/${id}/status`, { is_active: isActive }),
  resetPassword: (id, newPassword) => api.patch(`/users/${id}/reset-password`, { new_password: newPassword }),
  remove: (id) => api.delete(`/users/${id}`),

  // ---- Self-service (sidebar user-menu) ----
  /** Update the logged-in user's own name/phone. */
  updateOwnProfile: (payload) => api.put('/users/me', payload),
  /** Change the logged-in user's own password (requires the current one). */
  changeOwnPassword: (currentPassword, newPassword) =>
    api.patch('/users/me/password', { current_password: currentPassword, new_password: newPassword }),
  /** Profile photo upload is multipart, not JSON — bypasses the JSON-only api client
   *  the same way templateService.uploadLogo does. */
  uploadAvatar: async (file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    const res = await fetch(`${BASE_URL}/users/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAuthToken()}` },
      body: formData,
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.message || 'Profile photo upload failed.');
    return payload;
  },
  /** Clears the logged-in user's saved photo — falls back to initials afterward. */
  removeAvatar: () => api.delete('/users/me/avatar'),
};
