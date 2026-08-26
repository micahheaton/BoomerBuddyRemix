export async function completeMobileSignOut(input: {
  readonly clearDeviceState: () => Promise<void>;
  readonly signOutIdentitySession: () => Promise<void>;
}): Promise<'complete' | 'retry_required'> {
  const deviceStateCleared = await clearMobileDeviceStateSafely(input.clearDeviceState);
  try {
    await input.signOutIdentitySession();
    return deviceStateCleared ? 'complete' : 'retry_required';
  } catch {
    return 'retry_required';
  }
}

export async function clearMobileDeviceStateSafely(
  clearDeviceState: () => Promise<void>,
): Promise<boolean> {
  try {
    await clearDeviceState();
    return true;
  } catch {
    // The in-memory household selection is cleared before secure-storage cleanup is attempted.
    return false;
  }
}
