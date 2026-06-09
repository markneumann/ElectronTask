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
  setStatus: (payload: SetStatusPayload) =>
    ipcRenderer.invoke('clickup:setStatus', payload) as Promise<SetStatusResult>,
  setActiveTask: (payload: SetActiveTaskPayload) =>
    ipcRenderer.invoke('clickup:setActiveTask', payload) as Promise<ActiveTaskState>,
  openTask: (payload: OpenTaskPayload) =>
    ipcRenderer.invoke('clickup:openTask', payload) as Promise<OpenTaskResult>,
  pause: () => ipcRenderer.invoke('clickup:pause') as Promise<ActiveTaskState>,
});

contextBridge.exposeInMainWorld('hotkey', {
  getStatus: () => ipcRenderer.invoke('hotkey:getStatus') as Promise<HotkeyStatus>,
  set: (payload: SetHotkeyPayload) =>
    ipcRenderer.invoke('hotkey:set', payload) as Promise<HotkeyStatus>,
});

contextBridge.exposeInMainWorld('settings', {
  getLaunchAtLogin: () =>
    ipcRenderer.invoke('settings:getLaunchAtLogin') as Promise<LaunchAtLoginStatus>,
  setLaunchAtLogin: (payload: SetLaunchAtLoginPayload) =>
    ipcRenderer.invoke(
      'settings:setLaunchAtLogin',
      payload,
    ) as Promise<LaunchAtLoginStatus>,
  setDefaultListId: (payload: SetDefaultListIdPayload) =>
    ipcRenderer.invoke('settings:setDefaultListId', payload) as Promise<AuthStatus>,
  showOptionsMenu: () =>
    ipcRenderer.invoke('settings:showOptionsMenu') as Promise<void>,
  onConfigureList: (callback: () => void) => {
    ipcRenderer.on('settings:configureList', () => {
      callback();
    });
  },
});
