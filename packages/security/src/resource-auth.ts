export async function enforceProductionResourceAuthentication(
  environment: string | undefined,
  protect: () => void | Promise<void>,
): Promise<void> {
  if (environment !== 'production') return;
  await protect();
}
