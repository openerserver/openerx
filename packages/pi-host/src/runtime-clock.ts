export function runtimeClockContext(
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  const weekdays: Record<string, string> = {
    Sunday: "星期日",
    Monday: "星期一",
    Tuesday: "星期二",
    Wednesday: "星期三",
    Thursday: "星期四",
    Friday: "星期五",
    Saturday: "星期六",
  };
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return [
    "Current runtime clock (provided by the app at the start of this run):",
    `Current date: ${date}`,
    `Current weekday: ${part("weekday")} (${weekdays[part("weekday")]})`,
    `Local date and time: ${date} ${part("hour")}:${part("minute")}:${part("second")}`,
    `Time zone: ${timeZone}`,
    `UTC instant: ${now.toISOString()}`,
    "Use this clock and time zone for today, the current date, and the weekday. Conversation history, documents, examples, and model training data do not define today's date. For another time zone, convert this UTC instant instead of guessing. The arithmetic calculator cannot read the clock or execute date/time functions; answer current-date questions directly from this context.",
  ].join("\n");
}
