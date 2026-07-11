type ApplyRejection = { name?: unknown; reason?: unknown };
type ApplyResponse = {
  type?: unknown;
  body?: { rejected?: unknown };
};

export const assertApplySucceeded = <T extends ApplyResponse | null | undefined>(
  response: T,
): T => {
  if (!response || response.type !== "APPLY_CONFIG_RESULT" || !response.body) {
    throw new Error("No save acknowledgement was received");
  }
  const rejected = Array.isArray(response.body.rejected)
    ? (response.body.rejected as ApplyRejection[])
    : [];
  if (rejected.length) {
    throw new Error(
      rejected
        .map((item) => `${String(item.name || "option")}: ${String(item.reason || "rejected")}`)
        .join(", "),
    );
  }
  return response;
};
