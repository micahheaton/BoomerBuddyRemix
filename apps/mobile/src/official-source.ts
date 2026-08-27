export function validatedOfficialSourceUrl(value: string): string | undefined {
  try {
    const source = new URL(value);
    if (
      source.protocol !== 'https:' ||
      source.username !== '' ||
      source.password !== '' ||
      source.port !== '' ||
      source.hash !== '' ||
      !source.hostname.endsWith('.gov')
    ) {
      return undefined;
    }
    return source.toString();
  } catch {
    return undefined;
  }
}
