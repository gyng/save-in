// @vitest-environment jsdom
import vm from "node:vm";

import { poll, waitForPageCondition } from "../e2e/helpers.mjs";

describe("in-page E2E waits", () => {
  test("uses one evaluation and resolves from a DOM signal", async () => {
    document.body.innerHTML = '<div id="status" data-ready="false"></div>';
    const evaluate = vi.fn(
      (expression: string) => vm.runInThisContext(expression) as Promise<unknown>,
    );

    const waiting = waitForPageCondition(
      evaluate,
      'document.querySelector("#status")?.dataset.ready === "true"',
      { description: "status" },
    );
    document.querySelector<HTMLElement>("#status")!.dataset.ready = "true";

    await expect(waiting).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledOnce();
  });

  test("fails immediately when the page condition throws", async () => {
    const evaluate = (expression: string) => vm.runInThisContext(expression) as Promise<unknown>;

    await expect(
      waitForPageCondition(evaluate, '(() => { throw new Error("broken condition") })()', {
        description: "broken state",
      }),
    ).rejects.toThrow("broken condition");
  });

  test("fails runner polling errors immediately by default", async () => {
    const check = vi.fn(() => {
      throw new Error("target failed");
    });

    await expect(poll(check)).rejects.toThrow("target failed");
    expect(check).toHaveBeenCalledOnce();
  });
});
