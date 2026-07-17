export type ExternalDownloadRejection = {
  senderId: string;
  attempts: number;
  lastRejectedAt: string;
  requestType: "url" | "activeTab" | "unknown";
};
