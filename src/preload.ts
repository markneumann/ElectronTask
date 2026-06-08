import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('widget', {
  ping: () => ipcRenderer.invoke('widget:ping') as Promise<WidgetPingResult>,
});
