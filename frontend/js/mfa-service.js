// Supabase owns TOTP secrets and verification. Enrollment data lives only in
// this page's memory/DOM; never put it in logs, URLs, or application storage.
window.createMfaService = function (client) {
  function validFactorId(value) {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      throw new Error("Invalid authenticator identifier. Retry the security check.");
    return value;
  }
  async function unwrap(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }
  const factors = async () => {
    const data = await unwrap(client.auth.mfa.listFactors());
    return (data.totp || []).filter(f => f.status === "verified");
  };
  async function verify(factorId, code) {
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit code from your authenticator.");
    validFactorId(factorId);
    const challenge = await unwrap(client.auth.mfa.challenge({ factorId }));
    return unwrap(client.auth.mfa.verify({ factorId, challengeId: challenge.id, code }));
  }
  async function retireOldFactor(newId, oldId) {
    if (!oldId || oldId === newId) throw new Error("Choose the previous authenticator to replace.");
    const verified = await factors();
    if (!verified.some(f => f.id === newId))
      throw new Error("The replacement authenticator must be verified first.");
    // Idempotent retry if deletion succeeded but session refresh failed.
    if (verified.some(f => f.id === oldId)) await unwrap(client.auth.mfa.unenroll({ factorId: validFactorId(oldId) }));
    await unwrap(client.auth.refreshSession());
  }
  return {
    factors,
    assurance: () => unwrap(client.auth.mfa.getAuthenticatorAssuranceLevel()),
    enroll: () => unwrap(client.auth.mfa.enroll({ factorType: "totp", friendlyName: "DILG authenticator " + Date.now(), issuer: "DILG Lucena" })),
    verify,
    retireOldFactor,
    async replace(newId, oldId, code) {
      await verify(newId, code); // If this fails, the old factor is untouched.
      await retireOldFactor(newId, oldId);
    },
    cancelEnrollment: id => unwrap(client.auth.mfa.unenroll({ factorId: validFactorId(id) })),
    async clearAbandonedEnrollments() {
      const data = await unwrap(client.auth.mfa.listFactors());
      for (const factor of data.all || []) {
        if (factor.factor_type === "totp" && factor.status === "unverified" && factor.friendly_name?.startsWith("DILG authenticator "))
          await unwrap(client.auth.mfa.unenroll({ factorId: validFactorId(factor.id) }));
      }
    },
  };
};
