/**
 * SMS behind an interface (PRD §15.1) so the provider can be swapped without touching the login
 * code. The mock sends nothing: the login page and the panel's test-codes page show the code. The
 * real provider is Kavenegar (DECISIONS.md), sending the code through a verify template.
 */
export interface SmsProvider {
  readonly name: string;
  /** True when codes are not really sent and may be shown on screen for testing. */
  readonly isMock: boolean;
  sendLoginCode(phone: string, code: string): Promise<void>;
}

/** The provider refused or could not be reached; the message is for the error log, not the user. */
export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SmsSendError";
  }
}

export const mockSmsProvider: SmsProvider = {
  name: "mock",
  isMock: true,
  async sendLoginCode() {},
};

type KavenegarOptions = { apiKey: string; template: string; fetch?: typeof fetch; timeoutMs?: number };

/**
 * Kavenegar's verify lookup: the text lives in a template approved in the Kavenegar panel, with one
 * `%token` where the code goes. Verify messages use Kavenegar's fast lane and reach numbers that
 * block advertising SMS.
 */
export function kavenegarSmsProvider({ apiKey, template, fetch: send = fetch, timeoutMs = 10_000 }: KavenegarOptions): SmsProvider {
  return {
    name: "kavenegar",
    isMock: false,
    async sendLoginCode(phone, code) {
      let response: Response;
      try {
        response = await send(`https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/verify/lookup.json`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          // Phones are stored as +989...; Kavenegar's own examples use the local 09... form.
          body: new URLSearchParams({ receptor: phone.replace(/^\+98/, "0"), token: code, template }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new SmsSendError(`Kavenegar unreachable: ${error instanceof Error ? error.message : String(error)}`, null);
      }
      // Kavenegar answers with {"return": {"status", "message"}} on success and on refusal alike.
      const body = (await response.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
      const status = body?.return?.status ?? response.status;
      if (status !== 200) {
        throw new SmsSendError(`Kavenegar refused (${status}): ${body?.return?.message ?? response.statusText}`, status);
      }
    },
  };
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function getSmsProvider(): SmsProvider {
  const name = process.env.SMS_PROVIDER ?? "mock";
  if (name === "mock") return mockSmsProvider;
  if (name === "kavenegar") {
    return kavenegarSmsProvider({ apiKey: required("SMS_API_KEY"), template: required("SMS_TEMPLATE") });
  }
  throw new Error(`Unknown SMS_PROVIDER: ${name}`);
}
