// Optional hCaptcha on signup (HCAPTCHA_SITEKEY + HCAPTCHA_SECRET). Fails closed: if the check cannot be
// completed the signup is refused rather than waved through.
import { config } from '../config.js';
import { HttpError } from '../http/errors.js';

export const captchaEnabled = () => Boolean(config.hcaptchaSitekey && config.hcaptchaSecret);

export async function verifyCaptcha(token: string | undefined, ip: string): Promise<void> {
  if (!captchaEnabled()) return;
  if (!token) throw new HttpError(400, 'captcha_required', 'Please complete the “I am human” check');
  try {
    const res = await fetch(config.hcaptchaVerifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.hcaptchaSecret!, response: token, remoteip: ip, sitekey: config.hcaptchaSitekey! }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { success?: boolean };
    if (!json.success) throw new HttpError(400, 'captcha_failed', 'The “I am human” check failed — please try again');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, 'captcha_unavailable', 'We could not verify the “I am human” check right now. Please try again in a minute.');
  }
}
