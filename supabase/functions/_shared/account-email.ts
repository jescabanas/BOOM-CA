import { setupRedirect } from "./account-applications.ts";

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

export async function sendAccountEmail(db: any, email: string, name: string, redirect: string, purpose: "invite" | "recovery") {
  const key = Deno.env.get("BREVO_API_KEY"), sender = Deno.env.get("EMAIL_FROM");
  if (!key || !sender) throw new Error("Email delivery is not configured.");
  if (purpose === "invite") {
    const {data:allowed,error:limitError} = await db.rpc("consume_auth_email_attempt",{p_email:email});
    if (limitError || !allowed) throw new Error("Please wait before requesting another setup email.");
  }
  const { data, error } = await db.auth.admin.generateLink({type:"recovery", email, options:{redirectTo:setupRedirect(redirect)}});
  if (error || !data?.properties?.hashed_token) throw new Error("Could not generate an account security link.");
  // The app verifies the token only after the recipient explicitly continues.
  // Mail scanners opening the URL cannot consume this one-use credential.
  const link = new URL(setupRedirect(redirect));
  link.searchParams.set("token_hash", data.properties.hashed_token);
  link.searchParams.set("type", "recovery");
  link.searchParams.set("purpose", purpose);
  const invitation = purpose === "invite";
  const title = invitation ? "Account invitation and password setup" : "Password reset request";
  const intro = invitation
    ? "Your access to the Lucena City Barangay Compliance System has been authorized. Please create your personal password to complete your account setup."
    : "We received a request to reset the password for your Lucena City Barangay Compliance System account. Please use the secure link below to choose a new password.";
  const action = invitation ? "Create my password" : "Reset my password";
  const footer = invitation ? "If you were not expecting this invitation, please contact DILG Lucena before proceeding." : "If you did not request a password reset, please disregard this email. Your password remains unchanged.";
  const safeLink = escape(link.href);
  const html = `<!doctype html><html><body style="margin:0;background:#F8F4EF;font-family:Arial,sans-serif;color:#2F2024"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" style="width:100%;max-width:560px;background:white;border:1px solid #EAE2DF;border-radius:16px"><tr><td align="center" style="padding:28px;background:#671C2E;color:white"><img src="https://dilgtest2.netlify.app/assets/images/DILG-Logo.png" alt="DILG seal" width="76" height="76"><p style="font-weight:bold;line-height:1.6">DEPARTMENT OF THE INTERIOR<br>AND LOCAL GOVERNMENT</p><p>DILG Lucena · Barangay Compliance System</p></td></tr><tr><td style="padding:28px;line-height:1.7"><h1 style="font-family:Georgia,serif;font-size:26px;color:#671C2E">${title}</h1><p>Dear ${escape(name || "Account Holder")},</p><p>${intro}</p><p style="margin:28px 0"><a href="${safeLink}" style="display:inline-block;background:#671C2E;color:white;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${action}</a></p><p>This link may be used once. Please complete this action promptly and use the most recent email if another link has been requested.</p><p>If an authenticator is already enrolled, its verification code is required to save the new password.</p><p>${footer} Never share your password, authenticator code, or this link.</p><p style="word-break:break-all;font-size:12px">If the button does not work, copy this link into your browser:<br><a href="${safeLink}">${safeLink}</a></p><p>Respectfully,<br><strong>DILG Lucena</strong><br>Department of the Interior and Local Government</p></td></tr><tr><td align="center" style="padding:18px;border-top:1px solid #EAE2DF;font-size:12px">This is an automated account-security message. Please do not reply.</td></tr></table></td></tr></table></body></html>`;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {method:"POST", headers:{"Content-Type":"application/json","api-key":key}, body:JSON.stringify({sender:{email:sender,name:"DILG Lucena — Department of the Interior and Local Government"},to:[{email,name}],subject:`DILG Lucena — ${title}`,htmlContent:html,textContent:`Dear ${name || "Account Holder"},\n\n${intro}\n\n${action}: ${link.href}\n\n${footer}\n\nRespectfully,\nDILG Lucena\nDepartment of the Interior and Local Government`})});
  if (!response.ok) throw new Error("The email provider could not deliver the message. Please try again later.");
}
