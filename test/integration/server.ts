import type { AddressInfo, Server } from "node:net";

export const listenOnLoopback = (server: Server): Promise<AddressInfo> =>
  new Promise((resolve, reject) => {
    const removeListeners = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error: Error) => {
      removeListeners();
      reject(error);
    };
    const onListening = () => {
      removeListeners();
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Missing test server port"));
        return;
      }
      resolve(address);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

export const closeServer = (server: Server): Promise<void> => {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
};
