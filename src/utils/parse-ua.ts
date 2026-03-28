export function parseUserAgent(ua: string | null): string {
  if (!ua) return "—";

  let browser = "Браузер";
  let os = "ОС";

  if (ua.includes("Firefox/")) {
    const m = ua.match(/Firefox\/([\d]+)/);
    browser = `Firefox ${m?.[1] ?? ""}`;
  } else if (ua.includes("Edg/")) {
    const m = ua.match(/Edg\/([\d]+)/);
    browser = `Edge ${m?.[1] ?? ""}`;
  } else if (ua.includes("OPR/") || ua.includes("Opera/")) {
    const m = ua.match(/OPR\/([\d]+)/);
    browser = `Opera ${m?.[1] ?? ""}`;
  } else if (ua.includes("YaBrowser/")) {
    const m = ua.match(/YaBrowser\/([\d.]+)/);
    browser = `Яндекс ${m?.[1]?.split(".")[0] ?? ""}`;
  } else if (ua.includes("Chrome/")) {
    const m = ua.match(/Chrome\/([\d]+)/);
    browser = `Chrome ${m?.[1] ?? ""}`;
  } else if (ua.includes("Safari/") && !ua.includes("Chrome")) {
    const m = ua.match(/Version\/([\d]+)/);
    browser = `Safari ${m?.[1] ?? ""}`;
  }

  if (ua.includes("Windows NT 10")) os = "Windows 10/11";
  else if (ua.includes("Windows NT 6.3")) os = "Windows 8.1";
  else if (ua.includes("Windows NT 6.1")) os = "Windows 7";
  else if (ua.includes("Mac OS X")) {
    const m = ua.match(/Mac OS X ([\d_]+)/);
    os = `macOS ${m?.[1]?.replace(/_/g, ".") ?? ""}`;
  } else if (ua.includes("Android")) {
    const m = ua.match(/Android ([\d.]+)/);
    os = `Android ${m?.[1] ?? ""}`;
  } else if (ua.includes("iPhone") || ua.includes("iPad")) {
    const m = ua.match(/OS ([\d_]+)/);
    os = `iOS ${m?.[1]?.replace(/_/g, ".") ?? ""}`;
  } else if (ua.includes("Linux")) os = "Linux";

  return `${browser} / ${os}`;
}