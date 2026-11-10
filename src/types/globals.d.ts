declare const __APP_VERSION__: string;
declare const __SINGLE__: boolean;

interface TpPickerType {
  description?: string;
  accept: Record<string, string[]>;
}

interface Window {
  showOpenFilePicker?(options?: { multiple?: boolean; id?: string; types?: TpPickerType[] }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: { suggestedName?: string; id?: string; types?: TpPickerType[] }): Promise<FileSystemFileHandle>;
}

interface FileSystemFileHandle {
  /** Chromium only: renames the file in place. */
  move?(name: string): Promise<void>;
}

interface LaunchParams {
  files: FileSystemFileHandle[];
}

interface Window {
  launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
}

interface FileSystemHandle {
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
