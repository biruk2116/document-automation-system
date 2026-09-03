import { api } from './api';

export const notificationService = {
  getAll: () => api.get('/notifications'),
  markRead: (type, id) => api.post(`/notifications/${type}/${id}/read`),
};
