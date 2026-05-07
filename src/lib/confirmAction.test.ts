import { describe, expect, test, vi } from "vitest";
import { confirmAction } from "./confirmAction";

describe("confirmAction", () => {
  test("runs the action when the user confirms", () => {
    const action = vi.fn();
    const confirm = vi.fn(() => true);

    const didRun = confirmAction("确定执行？", action, confirm);

    expect(didRun).toBe(true);
    expect(confirm).toHaveBeenCalledWith("确定执行？");
    expect(action).toHaveBeenCalledTimes(1);
  });

  test("does not run the action when the user cancels", () => {
    const action = vi.fn();
    const confirm = vi.fn(() => false);

    const didRun = confirmAction("确定执行？", action, confirm);

    expect(didRun).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
});
