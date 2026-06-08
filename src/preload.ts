import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('widget', {
  ping: () => ipcRenderer.invoke('widget:ping') as Promise<WidgetPingResult>,
});

contextBridge.exposeInMainWorld('auth', {
  getStatus: () => ipcRenderer.invoke('auth:getStatus') as Promise<AuthStatus>,
  saveToken: (payload: SaveTokenPayload) =>
    ipcRenderer.invoke('auth:saveToken', payload) as Promise<AuthStatus>,
  clearToken: () => ipcRenderer.invoke('auth:clearToken') as Promise<AuthStatus>,
});

contextBridge.exposeInMainWorld('clickup', {
  getMyTasks: () =>
    ipcRenderer.invoke('clickup:getMyTasks') as Promise<ClickUpSnapshot>,
});
