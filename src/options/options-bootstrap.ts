type OptionsBootstrapPorts = {
  document: Document;
  ready: Array<() => void>;
  configureRuntime(): void;
  addMessageListener(listener: (message: { type?: string }) => void): void;
  onDownloaded(): void;
  startBrowserDetection(): void;
};

export const bootstrapOptionsPage = (ports: OptionsBootstrapPorts): void => {
  ports.configureRuntime();
  ports.ready.forEach((callback) => ports.document.addEventListener("DOMContentLoaded", callback));
  ports.addMessageListener((message) => {
    if (message.type === "DOWNLOADED") ports.onDownloaded();
  });
  ports.startBrowserDetection();
};
