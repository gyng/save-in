type OptionsBootstrapPorts = {
  document: Document;
  ready: Array<() => void | Promise<void>>;
  configureRuntime(): void;
  addMessageListener(listener: (message: { type?: string }) => void): void;
  onDownloaded(): void;
  startBrowserDetection(): void;
};

export const bootstrapOptionsPage = (ports: OptionsBootstrapPorts): (() => Promise<void>) => {
  let started = false;
  let completion = Promise.resolve();
  return () => {
    if (started) return completion;
    started = true;
    ports.configureRuntime();
    ports.addMessageListener((message) => {
      if (message.type === "DOWNLOADED") ports.onDownloaded();
    });
    ports.startBrowserDetection();
    completion = Promise.all(ports.ready.map((callback) => callback())).then(() => undefined);
    return completion;
  };
};
