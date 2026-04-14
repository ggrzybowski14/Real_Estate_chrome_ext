/**
 * Launch options for Realtor.ca map: their page XHRs to api2.realtor.ca; in Playwright/Chromium-for-Testing
 * the console often shows "CORS" / net::ERR_FAILED while listing APIs never return — pins stay empty.
 * Relaxed flags (opt out via REALTOR_PW_STRICT_CORS) mirror a common local-debug workaround; use only for this CLI.
 */
import type { LaunchOptions } from "playwright";

const ALLOWED_CHANNELS = new Set(["chrome", "chrome-beta", "msedge", "chromium"]);

export type RealtorLaunchConfig = {
  /** When false, adds --disable-web-security (default true). */
  relaxedCors: boolean;
  /** e.g. "chrome" to use system Google Chrome instead of bundled Chromium. */
  channel: string | undefined;
  ignoreHttpsErrors: boolean;
};

export function resolveRealtorLaunchConfig(): RealtorLaunchConfig {
  const strict =
    process.env.REALTOR_PW_STRICT_CORS === "true" || process.env.REALTOR_PW_STRICT_CORS === "1";
  const channelRaw = process.env.REALTOR_PW_CHANNEL?.trim();
  const channel =
    channelRaw && ALLOWED_CHANNELS.has(channelRaw) ? channelRaw : undefined;
  const ignoreHttpsErrors =
    process.env.REALTOR_PW_IGNORE_HTTPS_ERRORS === "true" ||
    process.env.REALTOR_PW_IGNORE_HTTPS_ERRORS === "1";
  return {
    relaxedCors: !strict,
    channel,
    ignoreHttpsErrors
  };
}

export function buildChromiumLaunchOptions(input: {
  headless: boolean;
  config: RealtorLaunchConfig;
}): LaunchOptions {
  const { headless, config } = input;
  const args = [
    "--disable-blink-features=AutomationControlled",
    ...(config.relaxedCors
      ? ([
          "--disable-web-security",
          "--disable-site-isolation-trials",
          "--disable-features=IsolateOrigins,site-per-process"
        ] as const)
      : [])
  ];

  const launch: LaunchOptions = {
    headless,
    args: [...args]
  };

  if (config.channel) {
    launch.channel = config.channel as LaunchOptions["channel"];
  }

  return launch;
}
