// Database helpers enforce administrator role, restoration and audit
// rules atomically. Only the server holds the service key.
export async function inviteSystemUser(db: any, actorId: string, input: any, sendEmail: any, redirectFor: any) {
  const fullName = typeof input?.full_name === "string" ? input.full_name.trim() : "";
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const role = input?.role;
  if (!fullName || fullName.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !["super_admin"].includes(role)) {
    return { status: 400, body: { error: "Enter a full name, valid email and a Super Administrator role." } };
  }
  let redirect: string;
  try { redirect = redirectFor(input?.setup_redirect); }
  catch { return { status: 400, body: { error: "Invalid invitation setup URL." } }; }
  const { data: existing, error: lookupError } = await db.rpc("lookup_user_invitation", {p_actor_id:actorId,p_email:email});
  if (lookupError) return { status: 500, body: { error: "Could not check the existing account. No invitation was sent." } };
  if (existing?.banned) return { status: 409, body: { error: "This authentication account is banned. Contact the project owner before inviting it." } };
  if (existing?.has_profile && existing.is_active) {
    return { status: 409, body: { error: "This account is already active. Its role has not been changed. Use Resend setup email in Users." } };
  }
  if (existing?.has_profile && input.restore_existing !== true) {
    return { status: 409, body: { code: "ACCOUNT_RESTORATION_REQUIRED", error: "This email belongs to a removed or disabled account. Select Restore removed or disabled account and send the invitation again." } };
  }
  let userId = existing?.id;
  let createdHere = false;
  if (!userId) {
    const {data,error} = await db.auth.admin.createUser({email,password:crypto.randomUUID()+crypto.randomUUID(),email_confirm:true,user_metadata:{full_name:fullName}});
    if (error || !data?.user) return { status: 409, body: { error: "Could not create this account. It may already exist; refresh and try again." } };
    userId=data.user.id;
    createdHere=true;
  }
  const {data:completed,error:profileError} = await db.rpc("complete_user_invitation", {
    p_actor_id:actorId,p_user_id:userId,p_full_name:fullName,p_email:email,p_role:role,
    p_barangay_id:null,p_restore_existing:input.restore_existing === true,
  });
  if (profileError || !completed?.success) {
    // Roll back only identities created by this request, never an existing user.
    if (createdHere) await db.auth.admin.deleteUser(userId);
    return { status: 409, body: { error: profileError?.message || "The account could not be invited." } };
  }
  const description=completed.restored ? "Account restored" : "Account added";
  try {
    await sendEmail(db,email,fullName,redirect,"invite");
    return { status: 200, body: {success:true,user_id:userId,restored:completed.restored,email_sent:true,message:description+". A setup invitation has been sent."} };
  } catch {
    return { status: 200, body: {success:true,user_id:userId,restored:completed.restored,email_sent:false,message:description+". Email delivery failed; use Resend setup email in Users."} };
  }
}
