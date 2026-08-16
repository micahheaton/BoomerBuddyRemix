export const autonomyClasses = ['auto', 'approval', 'human', 'professional'] as const;
export type AutonomyClass = (typeof autonomyClasses)[number];

export interface AutomationPolicy {
  action: string;
  allowedDataClasses: string[];
  allowedTools: string[];
  autonomy: AutonomyClass;
  budgetCents: number;
  enabled: boolean;
  requiresAudit: boolean;
}

export interface AutomationRequest {
  action: string;
  dataClasses: string[];
  estimatedCostCents: number;
  tool: string;
}

export interface AutomationDecision {
  allowed: boolean;
  disposition: AutonomyClass | 'blocked';
  reasons: string[];
}

export const autoEligibleActions = Object.freeze([
  'prepare_owner_brief',
  'identify_stale_work',
  'create_internal_task',
  'score_approved_rules',
  'generate_internal_draft',
  'summarize_internal',
  'approved_internal_maintenance',
  'provider_health_check',
  'attribution_processing',
] as const);

const autoEligibleActionSet = new Set<string>(autoEligibleActions);

type AutoEligibleAction = (typeof autoEligibleActions)[number];

interface AutoExecutionBoundary {
  readonly dataClasses: readonly string[];
  readonly tools: readonly string[];
}

/** Owner policies can narrow this code-owned boundary, but cannot expand it. */
export const autoExecutionBoundaries: Readonly<Record<AutoEligibleAction, AutoExecutionBoundary>> =
  Object.freeze({
    prepare_owner_brief: {
      tools: ['local_database'],
      dataClasses: ['aggregate_metrics'],
    },
    identify_stale_work: {
      tools: ['local_database'],
      dataClasses: ['content_free_operational_metadata'],
    },
    create_internal_task: {
      tools: ['hq'],
      dataClasses: ['public', 'content_free_operational_metadata'],
    },
    score_approved_rules: {
      tools: ['local_rules'],
      dataClasses: ['public', 'aggregate_metrics', 'content_free_operational_metadata'],
    },
    generate_internal_draft: {
      tools: ['internal_drafts'],
      dataClasses: ['public', 'approved_content'],
    },
    summarize_internal: {
      tools: ['local_database'],
      dataClasses: ['aggregate_metrics', 'content_free_operational_metadata'],
    },
    approved_internal_maintenance: {
      tools: ['local_database'],
      dataClasses: ['content_free_operational_metadata'],
    },
    provider_health_check: {
      tools: ['local_database'],
      dataClasses: ['provider_health'],
    },
    attribution_processing: {
      tools: ['local_database'],
      dataClasses: ['attribution_metadata'],
    },
  });

export function isAutoEligibleAction(action: string): boolean {
  return autoEligibleActionSet.has(action);
}

function autoBoundary(action: string): AutoExecutionBoundary | undefined {
  return isAutoEligibleAction(action)
    ? autoExecutionBoundaries[action as AutoEligibleAction]
    : undefined;
}

export function isAutoPolicyWithinBoundary(policy: AutomationPolicy): boolean {
  const boundary = autoBoundary(policy.action);
  return (
    boundary !== undefined &&
    policy.allowedTools.every((tool) => boundary.tools.includes(tool)) &&
    policy.allowedDataClasses.every((dataClass) => boundary.dataClasses.includes(dataClass))
  );
}

export function authorizeAutomation(
  policy: AutomationPolicy | undefined,
  request: AutomationRequest,
  globalKillSwitch: boolean,
): AutomationDecision {
  const reasons: string[] = [];
  if (globalKillSwitch) reasons.push('The global automation kill switch is active.');
  if (policy === undefined || !policy.enabled)
    reasons.push('No enabled policy authorizes this action.');
  if (policy !== undefined && policy.action !== request.action)
    reasons.push('Policy action does not match.');
  if (policy !== undefined && !policy.allowedTools.includes(request.tool))
    reasons.push('Tool is not allowed.');
  if (
    policy !== undefined &&
    request.dataClasses.some((dataClass) => !policy.allowedDataClasses.includes(dataClass))
  ) {
    reasons.push('The request includes an unapproved data class.');
  }
  if (policy !== undefined && request.estimatedCostCents > policy.budgetCents) {
    reasons.push('The request exceeds the policy budget.');
  }
  if (policy?.autonomy === 'auto' && !isAutoEligibleAction(request.action)) {
    reasons.push('This action is not eligible for autonomous execution.');
  }
  if (policy?.autonomy === 'auto' && !isAutoPolicyWithinBoundary(policy)) {
    reasons.push('The policy exceeds the code-owned autonomous execution boundary.');
  }
  const boundary = policy?.autonomy === 'auto' ? autoBoundary(request.action) : undefined;
  if (
    boundary !== undefined &&
    (!boundary.tools.includes(request.tool) ||
      request.dataClasses.some((dataClass) => !boundary.dataClasses.includes(dataClass)))
  ) {
    reasons.push('The request exceeds the code-owned autonomous execution boundary.');
  }
  if (reasons.length > 0 || policy === undefined) {
    return { allowed: false, disposition: 'blocked', reasons };
  }
  return {
    allowed: policy.autonomy === 'auto',
    disposition: policy.autonomy,
    reasons: policy.autonomy === 'auto' ? [] : [`${policy.autonomy} handling is required.`],
  };
}

export interface FounderWorkflow {
  automationFraction: number;
  delegationFraction: number;
  founderMinutesPerOccurrence: number;
  frequencyPerMonth: number;
  highValueFounderWork: boolean;
  name: string;
}

export interface FounderDependencyResult {
  currentFounderHoursPerMonth: number;
  currentScore: number;
  protectedHighValueHoursPerMonth: number;
  targetFounderHoursPerMonth: number;
  targetScore: number;
}

export function calculateFounderDependency(workflows: FounderWorkflow[]): FounderDependencyResult {
  let currentMinutes = 0;
  let targetMinutes = 0;
  let protectedMinutes = 0;
  for (const workflow of workflows) {
    const minutes = workflow.frequencyPerMonth * workflow.founderMinutesPerOccurrence;
    currentMinutes += minutes;
    if (workflow.highValueFounderWork) {
      targetMinutes += minutes;
      protectedMinutes += minutes;
      continue;
    }
    const removableFraction = Math.min(
      1,
      Math.max(0, workflow.automationFraction + workflow.delegationFraction),
    );
    targetMinutes += minutes * (1 - removableFraction);
  }
  const baseline = Math.max(1, currentMinutes);
  return {
    currentFounderHoursPerMonth: currentMinutes / 60,
    currentScore: Math.round((currentMinutes / baseline) * 100),
    protectedHighValueHoursPerMonth: protectedMinutes / 60,
    targetFounderHoursPerMonth: targetMinutes / 60,
    targetScore: Math.round((targetMinutes / baseline) * 100),
  };
}
