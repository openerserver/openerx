import { describe, expect, it } from "vitest";
import { runtimeClockContext } from "../src/runtime-clock";

describe("runtime clock context", () => {
  it.each([
    ["2026-10-08T16:00:00Z", "Asia/Shanghai", "2026-10-09", "Friday (星期五)", "00:00:00"],
    ["2026-10-08T16:00:00Z", "UTC", "2026-10-08", "Thursday (星期四)", "16:00:00"],
    ["2026-10-09T01:00:00Z", "America/Los_Angeles", "2026-10-08", "Thursday (星期四)", "18:00:00"],
    ["2026-03-08T06:59:59Z", "America/New_York", "2026-03-08", "Sunday (星期日)", "01:59:59"],
    ["2026-03-08T07:00:00Z", "America/New_York", "2026-03-08", "Sunday (星期日)", "03:00:00"],
    ["2028-02-29T12:00:00Z", "UTC", "2028-02-29", "Tuesday (星期二)", "12:00:00"],
  ])("uses the actual local calendar at %s in %s", (instant, zone, date, weekday, time) => {
    const context = runtimeClockContext(new Date(instant), zone);
    expect(context).toContain(`Current date: ${date}`);
    expect(context).toContain(`Current weekday: ${weekday}`);
    expect(context).toContain(`Local date and time: ${date} ${time}`);
    expect(context).toContain(`Time zone: ${zone}`);
    expect(context).toContain(`UTC instant: ${new Date(instant).toISOString()}`);
  });
});
