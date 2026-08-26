import type { CheckResult, FamilyResponse, OrientationStateDto } from '@boomerbuddy/contracts';
import type { FraudAssessment, FraudEvidence } from '@boomerbuddy/fraud';
import type {
  DecisionRecord,
  FamilyRepository,
  RelationshipRecord,
  StoredCheck,
  StoredOrientation,
} from '@boomerbuddy/persistence';

function evidenceKind(evidence: FraudEvidence): DecisionRecord['evidence'][number]['kind'] {
  if (evidence.source.kind === 'provider') return 'reputation';
  if (evidence.source.kind === 'missing_or_failed') return 'missing';
  return 'artifact';
}

function evidenceLabel(evidence: FraudEvidence): string {
  if (evidence.source.kind === 'artifact_derived') return 'Pattern in the submitted content';
  if (evidence.source.kind === 'missing_or_failed') return 'Evidence gap';
  return `${evidence.source.name} observation`.slice(0, 120);
}

function customerEvidenceLabel(label: string): string {
  return label === 'Local pattern' ? 'Pattern in the submitted content' : label;
}

export function decisionFromAssessment(assessment: FraudAssessment): DecisionRecord {
  const providerEvidence = assessment.evidence.find(
    (item) => item.source.kind !== 'artifact_derived',
  );
  const providerStatus = providerEvidence?.source.status;
  const providerState: DecisionRecord['provider']['state'] =
    providerStatus === 'observed'
      ? 'verified'
      : providerStatus === 'unavailable'
        ? 'unavailable'
        : providerStatus === 'mock'
          ? 'mock'
          : 'unknown';
  return {
    risk: assessment.risk,
    evidenceSufficiency: assessment.confidence,
    calibration: assessment.calibration,
    summary: `${assessment.explanation.headline} ${assessment.explanation.limitation}`.slice(
      0,
      1_000,
    ),
    evidence: assessment.evidence.slice(0, 50).map((item) => ({
      kind: evidenceKind(item),
      label: evidenceLabel(item),
      observation: item.label.slice(0, 500),
      limitations: item.limitation.slice(0, 500),
    })),
    actions: assessment.actions.slice(0, 20).map((action) => ({
      key: action.id,
      priority: action.priority,
      title: action.title.slice(0, 160),
      detail: action.instruction.slice(0, 800),
      officialChannelOnly: action.id === 'verify_using_official_channel',
    })),
    provider: {
      name: providerEvidence?.source.name ?? 'local-unknown',
      state: providerState,
      version: providerEvidence?.source.version ?? '1',
    },
    rulesetVersion: assessment.versions.scoring,
  };
}

export function checkDto(check: StoredCheck, actorPersonId: string): CheckResult {
  const owned = check.ownerPersonId === actorPersonId;
  return {
    id: check.id,
    householdId: check.householdId,
    kind: check.kind,
    // Historic Run 1 rows may retain the reserved value for migration evidence,
    // but active API semantics never represent absence of bad evidence as safety.
    risk: check.risk === 'lower_concern' ? 'unknown' : check.risk,
    evidenceSufficiency: check.evidenceSufficiency,
    calibration: check.calibration,
    summary: check.summary,
    evidence: check.evidence.map((item) => ({
      ...item,
      label: customerEvidenceLabel(item.label),
    })),
    actions: check.actions.map((item) => ({ ...item })),
    provider: { ...check.provider },
    rulesetVersion: check.rulesetVersion,
    createdAt: check.createdAt.toISOString(),
    retention: { state: check.state, deleteAfter: check.deleteAfter.toISOString() },
    access: {
      kind: owned ? 'owned' : 'shared',
      canDelete: owned,
      canShare: owned,
    },
  };
}

export function relationshipDto(relationship: RelationshipRecord) {
  return {
    id: relationship.id,
    protectedPersonId: relationship.protectedPersonId,
    trustedPersonId: relationship.trustedPersonId,
    trustedDisplayName: relationship.trustedDisplayName,
    permissions: [...relationship.permissions],
    state: relationship.state,
    consentVersion: relationship.consentVersion,
    createdAt: relationship.createdAt.toISOString(),
    ...(relationship.endedAction === undefined ? {} : { endedAction: relationship.endedAction }),
    ...(relationship.endedAt === undefined ? {} : { endedAt: relationship.endedAt.toISOString() }),
  };
}

export function familyDto(
  family: NonNullable<Awaited<ReturnType<FamilyRepository['list']>>>,
): FamilyResponse {
  return {
    household: family.household,
    members: family.members.map((member) => ({ ...member })),
    relationships: family.relationships.map(relationshipDto),
    invitations: family.invitations.map((invitation) => ({
      ...invitation,
      permissions: [...invitation.permissions],
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    })),
  };
}

export function orientationDto(orientation: StoredOrientation): OrientationStateDto {
  return {
    householdId: orientation.householdId,
    personId: orientation.personId,
    status: orientation.state.status,
    completedSteps: [...orientation.state.completedSteps],
    safeWordDisposition: orientation.state.safeWordDisposition,
    needsAttention: orientation.state.needsAttention,
    updatedAt: orientation.state.updatedAt.toISOString(),
  };
}
