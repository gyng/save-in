type OptionsBootstrapPorts = {
  document: Document;
  ready: Array<() => void>;
  configureRuntime(): void;
  addMessageListener(listener: (message: { type?: string }) => void): void;
  onDownloaded(): void;
  startBrowserDetection(): void;
};

export const bootstrapOptionsPage = (ports: OptionsBootstrapPorts): (() => void) => {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    ports.configureRuntime();
    ports.addMessageListener((message) => {
      if (message.type === "DOWNLOADED") ports.onDownloaded();
    });
    ports.startBrowserDetection();
    ports.ready.forEach((callback) => callback());
  };
};
