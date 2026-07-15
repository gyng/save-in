import {
  fetchProtected,
  MAX_PROTECTED_URL_EXTENSIONS,
  type RefererProtection,
} from "../../src/shared/protected-fetch.ts";

const makeResponse = (status: number, url: string): Response => {
  const response = new Response("body", { status });
  Object.defineProperty(response, "url", { value: url });
  return response;
};

test("returns a successful response without consulting the protection", async () => {
  const extend = vi.fn(async () => true);
  const doFetch = vi.fn(async () => makeResponse(200, "https://cdn.example/file"));

  const response = await fetchProtected(doFetch, { extend });

  expect(response.status).toBe(200);
  expect(doFetch).toHaveBeenCalledOnce();
  expect(extend).not.toHaveBeenCalled();
});

test("extends protection to the redirected target and refetches", async () => {
  const failed = makeResponse(403, "https://s3.example/file?sig=1");
  const cancel = vi.spyOn(failed.body!, "cancel");
  const doFetch = vi
    .fn<() => Promise<Response>>()
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce(makeResponse(200, "https://s3.example/file?sig=1"));
  const extend = vi.fn(async () => true);

  const response = await fetchProtected(doFetch, { extend });

  expect(response.ok).toBe(true);
  expect(extend).toHaveBeenCalledExactlyOnceWith("https://s3.example/file?sig=1");
  expect(doFetch).toHaveBeenCalledTimes(2);
  // The abandoned failure body must not keep its connection alive.
  expect(cancel).toHaveBeenCalledOnce();
});

test("returns the failed response when the protection refuses to extend", async () => {
  const doFetch = vi.fn(async () => makeResponse(403, "https://s3.example/file"));
  const extend = vi.fn(async () => false);

  const response = await fetchProtected(doFetch, { extend });

  expect(response.status).toBe(403);
  expect(doFetch).toHaveBeenCalledOnce();
});

test("caps refetches even when every extension is accepted", async () => {
  let hop = 0;
  const doFetch = vi.fn(async () => {
    hop += 1;
    return makeResponse(403, `https://hop${hop}.example/file`);
  });
  const extend = vi.fn(async () => true);

  const response = await fetchProtected(doFetch, { extend });

  expect(response.status).toBe(403);
  expect(doFetch).toHaveBeenCalledTimes(1 + MAX_PROTECTED_URL_EXTENSIONS);
  expect(extend).toHaveBeenCalledTimes(MAX_PROTECTED_URL_EXTENSIONS);
});

test("passes failures through untouched without protection or a response URL", async () => {
  const unprotected = vi.fn(async () => makeResponse(403, "https://s3.example/file"));
  await expect(fetchProtected(unprotected)).resolves.toMatchObject({ status: 403 });
  expect(unprotected).toHaveBeenCalledOnce();

  // An empty response.url (e.g. an opaque response) leaves nothing to extend to.
  const extend = vi.fn<RefererProtection["extend"]>(async () => true);
  const opaque = vi.fn(async () => makeResponse(403, ""));
  await expect(fetchProtected(opaque, { extend })).resolves.toMatchObject({ status: 403 });
  expect(opaque).toHaveBeenCalledOnce();
  expect(extend).not.toHaveBeenCalled();
});
