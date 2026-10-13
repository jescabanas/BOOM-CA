# DILG Lucena password recovery

The frontend fixes and email template are saved locally. **They are not automatically applied to the hosted Supabase project or Netlify.** Do not run SQL migrations for this change.

## 1. Allow the reset page in hosted Supabase

Open [Authentication → URL Configuration](https://supabase.com/dashboard/project/nptfdsblgsufghdtnjvk/auth/url-configuration).

Keep the Site URL as `https://dilgtest2.netlify.app`. Add these exact entries to Redirect URLs, preserving existing valid entries:

- `https://dilgtest2.netlify.app/reset-password.html`
- `http://localhost:5500/DILGtest2/frontend/reset-password.html` (the Live Server URL shown in your screenshots)
- `http://localhost:8888/reset-password.html` (if testing through Netlify Dev)

If your local server uses another port or folder, add its exact reset URL too. The frontend now derives this URL from the sign-in page directory, so local subfolder testing no longer incorrectly requests the server root.

Supabase requires the requested redirect to be allowlisted; otherwise it can fall back to the Site URL. The sign-in page now forwards recovery/invitation token payloads to `reset-password.html` before the Supabase SDK consumes them. Ordinary sign-in is unchanged.

## 2. Apply the branded email

Open [Authentication → Email Templates](https://supabase.com/dashboard/project/nptfdsblgsufghdtnjvk/auth/templates), select **Reset password**, and set:

- Subject: `DILG Lucena — Reset your Barangay Compliance System password`
- Body: copy the entire contents of `supabase/templates/recovery.html`.

Keep `{{ .ConfirmationURL }}` in both links. It verifies the recovery token; replacing it with a plain reset-page URL would break recovery. The template uses the existing DILG logo at `https://dilgtest2.netlify.app/assets/images/DILG-Logo.png`; ensure that asset remains publicly accessible. If you change domains, update this image URL.

The template/config file applies to local Supabase only until copied to the hosted project. `supabase db push` does not upload hosted email templates.

## 3. Sender identity

Branding the body does not change the sender address. Supabase's default mailer may still show **Supabase Auth** and its Supabase-owned sender, and may add its own footer. To send as an actual DILG Lucena mailbox, configure [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) with an authorized, verified sender and set its display name to `DILG Lucena · Barangay Compliance System`.

Do not claim that an unverified personal sender is an official government mailbox. No SMTP credentials have been created, read, or saved by this code change.

## 4. Publish and verify

1. Deploy the updated frontend to your existing Netlify site using your usual deployment workflow.
2. Request a **new** reset email from the sign-in page. An already-delivered message will not change its appearance, and older/used links may be expired.
3. Check the logo, sender, and button destination. The final page must be `/reset-password.html`, not sign-in.
4. Set your new password yourself. If an authenticator is still enrolled, verify it before saving the password.
5. If the administrator completed an authenticator reset (or this is a new account without one), saving the password opens a new QR code. Scan it and verify a code from the new authenticator. QR enrollment and verification happen after the password is saved; scanning alone does not finish setup.
6. Successful setup signs out the recovery session and returns to sign-in. Sign in with the email and new password, then verify the authenticator code to enter the system.

## 5. Lost password and lost authenticator

After checking the user's identity, choose **Reset Authenticator** in Users and wait for its success message. Then choose **Resend setup email**. The recipient opens the latest email, selects **Continue**, saves their new password, scans and verifies the new QR code, and returns to sign-in.

If the old authenticator prompt is already open, **Check authenticator reset** fetches the current factor list. It removes that prompt only when the provider confirms the old factor is gone. If a factor still exists, confirm the administrator reset succeeded; the frontend does not bypass a registered factor. A normal password-reset email keeps the existing authenticator requirement.

Enrollment failures can be retried without saving the password again. Incorrect verification codes keep the setup screen open. Setup material is cleared after verification and when leaving the page. No real account reset or invitation is performed as part of browser tests.

Publish `frontend/reset-password.html`, `frontend/admin.html`, and the referenced MFA stylesheet. Redeploy `reset-user-mfa` for its revised administrator guidance. No database migration or Auth policy change is required for this recovery sequence.

Dark mode is now limited to HTML pages marked `data-theme-scope="system"`. Sign-in, password reset, and public rankings are always light; visiting them does not erase your saved administrator/secretary appearance preference.

References: [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates), [local templates](https://supabase.com/docs/guides/local-development/customizing-email-templates).
