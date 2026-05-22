import { logger } from "./logger";

// Sends a magic-link email via Brevo (https://developers.brevo.com/reference/sendtransacemail)
// if BREVO_API_KEY is set; otherwise logs the link to the server console
// so dev / first-run still works.
export async function sendMagicLink(email: string, link: string): Promise<void> {
  const apiKey = process.env["BREVO_API_KEY"];
  const fromEmail = process.env["MAIL_FROM_EMAIL"] || "noreply@deluxe-paint.app";
  const fromName  = process.env["MAIL_FROM_NAME"]  || "Deluxe Paint";

  if (!apiKey) {
    logger.warn({ email, link }, "BREVO_API_KEY unset — magic link logged instead of emailed");
    // eslint-disable-next-line no-console
    console.log("\n=== MAGIC LINK ===\nFor:  " + email + "\nLink: " + link + "\n==================\n");
    return;
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "accept": "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email }],
      subject: "Connexion à Deluxe Paint",
      htmlContent: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; padding: 32px; color: #111;">
          <h1 style="font-size: 22px; margin: 0 0 16px;">Deluxe Paint · People of Verso</h1>
          <p>Clique le bouton pour te connecter (le lien expire dans 15 minutes) :</p>
          <p style="margin: 24px 0;">
            <a href="${link}"
               style="display: inline-block; padding: 12px 20px; background: #191919; color: #F0EFED;
                      text-decoration: none; border-radius: 2px; font-weight: 600;">
              Me connecter
            </a>
          </p>
          <p style="font-size: 12px; color: #888;">
            Si tu n'as pas demandé cette connexion, ignore cet email.
          </p>
          <p style="font-size: 11px; color: #aaa; word-break: break-all;">
            Lien direct : ${link}
          </p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, text }, "Brevo send failed");
    throw new Error("Brevo send failed: " + res.status);
  }
}
