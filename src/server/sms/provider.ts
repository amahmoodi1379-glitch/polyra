/**
 * SMS behind an interface (PRD §15.1) so the real provider can be swapped in without touching the
 * login code. The real Iranian provider is chosen in phase 0 (PRD §17.3); until then only the mock
 * exists. The mock sends nothing: the login page and the panel's test-codes page show the code.
 */
export interface SmsProvider {
  readonly name: string;
  /** True when codes are not really sent and may be shown on screen for testing. */
  readonly isMock: boolean;
  send(phone: string, text: string): Promise<void>;
}

export const mockSmsProvider: SmsProvider = {
  name: "mock",
  isMock: true,
  async send() {},
};

export function getSmsProvider(): SmsProvider {
  const name = process.env.SMS_PROVIDER ?? "mock";
  if (name === "mock") return mockSmsProvider;
  throw new Error(`Unknown SMS_PROVIDER: ${name}`);
}
