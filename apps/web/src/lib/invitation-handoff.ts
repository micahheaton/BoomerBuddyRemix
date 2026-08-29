export type InvitationHandoffKind = 'member' | 'trusted-circle';

export type InvitationHandoff = {
  readonly invitationId: string;
  readonly kind: InvitationHandoffKind;
};

const opaqueInvitationIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const handoffQueryKeys: Record<InvitationHandoffKind, string> = {
  member: 'memberInvitation',
  'trusted-circle': 'trustedInvitation',
};
const handoffAnchors: Record<InvitationHandoffKind, string> = {
  member: 'accept-member-invitation',
  'trusted-circle': 'accept-trusted-invitation',
};

function isInvitationId(value: string): boolean {
  return opaqueInvitationIdPattern.test(value);
}

export function buildInvitationHandoffPath(
  kind: InvitationHandoffKind,
  invitationId: string,
): string {
  if (!isInvitationId(invitationId)) {
    throw new TypeError('Expected an opaque invitation ID');
  }
  const query = new URLSearchParams({ [handoffQueryKeys[kind]]: invitationId });
  return `/member/family?${query.toString()}#${handoffAnchors[kind]}`;
}

export function readInvitationHandoff(search: string): InvitationHandoff | undefined {
  if (search.length > 512) return undefined;
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const entries = [...query.entries()];
  if (entries.length !== 1) return undefined;
  const entry = entries[0];
  if (entry === undefined) return undefined;
  const [queryKey, invitationId] = entry;
  const handoff = (Object.entries(handoffQueryKeys) as Array<[InvitationHandoffKind, string]>).find(
    ([, key]) => key === queryKey,
  );
  if (handoff === undefined || !isInvitationId(invitationId)) return undefined;
  return { invitationId, kind: handoff[0] };
}

export function invitationHandoffAnchor(kind: InvitationHandoffKind): string {
  return handoffAnchors[kind];
}
