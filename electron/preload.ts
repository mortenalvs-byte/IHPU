import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('ihpu', {
  version: '0.1.0'
});
